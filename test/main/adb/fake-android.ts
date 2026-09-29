import type { FakeDevice, FakeDeviceStream, ServiceHandler } from './fake-device';

/**
 * 서비스 계층 테스트용 가짜 Android. 실제 adbd의 서비스 프로토콜(shell v2, sync, exec:cmd,
 * root:, tcp:)을 FakeDeviceStream 위에서 흉내 내고, 상태(파일/패키지/root)를 메모리에 둔다.
 */
export class FakeAndroid {
  readonly files = new Map<string, { data: Buffer; mode: number; mtimeSec: number }>();
  readonly packages = new Set<string>();
  readonly shellCommands: string[] = [];
  readonly installs: Array<{ size: number; options: string[] }> = [];
  isRoot = false;
  /** root: 응답. "restarting"으로 시작하면 root 상태로 바꾸고 onAdbdRestart를 호출. */
  rootResponse = 'adbd cannot run as root in production builds\n';
  onAdbdRestart: () => void = () => {};
  /** true면 pm이 APK를 끝까지 읽기 전에 거부하고 스트림을 닫는다. */
  rejectInstallEarly = false;
  private sessions = new Map<string, Buffer[]>();
  /**
   * 연결(FakeDevice)별 reverse 규칙(remote → local). 실제 adbd처럼 연결이 끊기면 규칙도 사라진다
   * (새 연결은 새 FakeDevice이므로 빈 규칙으로 시작).
   */
  readonly reverses = new Map<FakeDevice, Map<string, string>>();
  /** tcp:0 요청 시 할당할 기기 포트. */
  nextDevicePort = 40000;
  /** 설정하면 이 remote에 대한 reverse를 FAIL로 거부(포트 사용 중 흉내). */
  busyRemote: string | undefined;

  readonly services: ServiceHandler = (destination) => {
    if (destination.startsWith('shell,v2,raw:')) {
      const command = destination.slice('shell,v2,raw:'.length);
      return (s) => void this.shell(s, command);
    }
    if (destination === 'sync:') return (s) => void this.sync(s);
    if (destination.startsWith('exec:cmd package ')) {
      const args = destination.slice('exec:cmd package '.length).split(' ');
      return (s) => void this.cmdPackage(s, args);
    }
    if (destination === 'root:') return (s) => void this.root(s);
    if (destination.startsWith('reverse:')) {
      return (s) => void this.reverse(s, destination.slice('reverse:'.length));
    }
    const tcp = /^tcp:(\d+)$/.exec(destination);
    if (tcp) return (s) => void this.upperEcho(s);
    return undefined;
  };

  // ---- shell v2 ----

  private async shell(s: FakeDeviceStream, command: string): Promise<void> {
    this.shellCommands.push(command);
    if (command === '') return this.interactive(s);
    const { stdout = '', stderr = '', exit = 0 } = this.run(command);
    if (stdout) await sendShell(s, 1, stdout);
    if (stderr) await sendShell(s, 2, stderr);
    await sendShell(s, 3, Buffer.from([exit]));
    s.close();
  }

  /** 대화형: stdin 패킷을 줄 단위로 실행, "exit"면 종료. */
  private async interactive(s: FakeDeviceStream): Promise<void> {
    for (;;) {
      const header = await s.readBytes(5);
      if (!header) return;
      const id = header.readUInt8(0);
      const payload = (await s.readBytes(header.readUInt32LE(1))) ?? Buffer.alloc(0);
      if (id === 3) break;
      for (const line of payload.toString('utf-8').split('\n').filter(Boolean)) {
        if (line === 'exit') {
          await sendShell(s, 3, Buffer.from([0]));
          s.close();
          return;
        }
        const { stdout = '' } = this.run(line);
        if (stdout) await sendShell(s, 1, stdout);
      }
    }
    await sendShell(s, 3, Buffer.from([0]));
    s.close();
  }

  private run(command: string): { stdout?: string; stderr?: string; exit?: number } {
    let m: RegExpExecArray | null;
    if ((m = /^echo (.*)$/.exec(command))) return { stdout: `${m[1]}\n` };
    if ((m = /^fail (\d+) (.*)$/.exec(command))) return { stderr: `${m[2]}\n`, exit: Number(m[1]) };
    if ((m = /^(?:cmd package|pm) uninstall (\S+)$/.exec(command))) {
      if (this.packages.delete(m[1])) return { stdout: 'Success\n' };
      return { stdout: 'Failure [DELETE_FAILED_INTERNAL_ERROR]\n', exit: 1 };
    }
    if ((m = /^pm install .*"(.+)"$/.exec(command))) {
      const file = this.files.get(m[1]);
      if (file?.data.subarray(0, 2).toString() === 'PK') {
        this.packages.add('com.example.app');
        return { stdout: 'Success\n' };
      }
      return { stdout: 'Failure [INSTALL_FAILED_INVALID_APK]\n', exit: 1 };
    }
    if (command.startsWith('rm -f ')) {
      for (const p of command.slice(6).match(/"[^"]+"/g) ?? []) this.files.delete(p.slice(1, -1));
      return {};
    }
    if (command === 'getprop service.adb.root') return { stdout: this.isRoot ? '1\n' : '\n' };
    return { stderr: `sh: ${command}: not found\n`, exit: 127 };
  }

  // ---- sync ----

  private async sync(s: FakeDeviceStream): Promise<void> {
    for (;;) {
      const header = await s.readBytes(8);
      if (!header) return;
      const id = header.toString('ascii', 0, 4);
      const arg = header.readUInt32LE(4);
      if (id === 'QUIT') {
        s.close();
        return;
      }
      const text = ((await s.readBytes(arg)) ?? Buffer.alloc(0)).toString('utf-8');
      if (id === 'SEND') await this.syncSend(s, text);
      else if (id === 'RECV') await this.syncRecv(s, text);
    }
  }

  private async syncSend(s: FakeDeviceStream, spec: string): Promise<void> {
    const comma = spec.lastIndexOf(',');
    const path = spec.slice(0, comma);
    const mode = Number(spec.slice(comma + 1));
    const parts: Buffer[] = [];
    for (;;) {
      const header = (await s.readBytes(8))!;
      const id = header.toString('ascii', 0, 4);
      const arg = header.readUInt32LE(4);
      if (id === 'DATA') {
        if (arg > 64 * 1024) throw new Error(`DATA too large: ${arg}`);
        parts.push((await s.readBytes(arg))!);
      } else if (id === 'DONE') {
        if (path.startsWith('/readonly/')) return sendSync(s, 'FAIL', 'Permission denied');
        this.files.set(path, { data: Buffer.concat(parts), mode, mtimeSec: arg });
        return sendSync(s, 'OKAY');
      }
    }
  }

  private async syncRecv(s: FakeDeviceStream, path: string): Promise<void> {
    const file = this.files.get(path);
    if (!file) return sendSync(s, 'FAIL', 'No such file or directory');
    for (let offset = 0; offset < file.data.length; offset += 64 * 1024) {
      await sendSync(s, 'DATA', file.data.subarray(offset, offset + 64 * 1024));
    }
    await sendSync(s, 'DONE');
  }

  // ---- exec:cmd package ----

  private async cmdPackage(s: FakeDeviceStream, args: string[]): Promise<void> {
    const [verb, ...rest] = args;
    const reply = async (text: string): Promise<void> => {
      await s.send(text);
      s.close();
    };
    if (verb === 'install') {
      const size = Number(rest[1]);
      this.installs.push({ size, options: rest.slice(2) });
      if (this.rejectInstallEarly) {
        await s.readBytes(4);
        return reply('Failure [INSTALL_FAILED_INVALID_APK: early]\n');
      }
      const apk = (await s.readBytes(size)) ?? Buffer.alloc(0);
      if (apk.subarray(0, 2).toString() !== 'PK') return reply('Failure [INSTALL_FAILED_INVALID_APK]\n');
      this.packages.add('com.example.app');
      return reply('Success\n');
    }
    if (verb === 'install-create') {
      const id = String(1000 + this.sessions.size);
      this.sessions.set(id, []);
      return reply(`Success: created install session [${id}]\n`);
    }
    if (verb === 'install-write') {
      const [, size, session] = rest;
      const data = (await s.readBytes(Number(size)))!;
      this.sessions.get(session)?.push(data);
      return reply(`Success: streamed ${size} bytes\n`);
    }
    if (verb === 'install-commit') {
      const parts = this.sessions.get(rest[0]) ?? [];
      if (parts.every((p) => p.subarray(0, 2).toString() === 'PK')) {
        this.packages.add(`com.example.split:${parts.length}`);
        return reply('Success\n');
      }
      return reply('Failure [INSTALL_FAILED_INVALID_APK]\n');
    }
    if (verb === 'install-abandon') return reply('Success\n');
    return reply(`Unknown command: ${verb}\n`);
  }

  // ---- reverse: ----

  /** 기기 앱이 reverse 포트에 접속하는 상황 흉내: 해당 규칙의 local로 호스트에 OPEN을 보낸다. */
  connectReverse(devicePort: number): Promise<FakeDeviceStream | null> {
    const entries = [...this.reverses.entries()];
    for (let i = entries.length - 1; i >= 0; i--) {
      const [device, rules] = entries[i];
      const local = rules.get(`tcp:${devicePort}`);
      if (local) return device.openFromDevice(local);
    }
    throw new Error(`기기 포트 ${devicePort}에 reverse 규칙이 없습니다.`);
  }

  /** 현재(가장 최근 연결) 규칙들. */
  currentReverses(): Map<string, string> {
    const all = [...this.reverses.values()];
    return all[all.length - 1] ?? new Map();
  }

  private async reverse(s: FakeDeviceStream, command: string): Promise<void> {
    let rules = this.reverses.get(s.device);
    if (!rules) this.reverses.set(s.device, (rules = new Map()));
    const reply = async (body: string): Promise<void> => {
      if (body) await s.send(body);
      s.close();
    };
    const protocolString = (v: string): string => v.length.toString(16).padStart(4, '0') + v;

    let m: RegExpExecArray | null;
    if ((m = /^forward(:norebind)?:(tcp:\d+);(.+)$/.exec(command))) {
      let remote = m[2];
      if (remote === this.busyRemote) return reply(`FAIL${protocolString('cannot bind listener: Address already in use')}`);
      if (m[1] && rules.has(remote)) return reply(`FAIL${protocolString('cannot rebind existing socket')}`);
      let port = '';
      if (remote === 'tcp:0') {
        port = String(this.nextDevicePort++);
        remote = `tcp:${port}`;
      }
      rules.set(remote, m[3]);
      return reply(`OKAY${port ? protocolString(port) : ''}`);
    }
    if ((m = /^killforward:(.+)$/.exec(command))) {
      if (!rules.delete(m[1])) return reply(`FAIL${protocolString(`listener '${m[1]}' not found`)}`);
      return reply('OKAY');
    }
    if (command === 'killforward-all') {
      rules.clear();
      return reply('OKAY');
    }
    if (command === 'list-forward') {
      const lines = [...rules].map(([remote, local]) => `host-19 ${remote} ${local}\n`).join('');
      return reply(protocolString(lines));
    }
    return reply(`FAIL${protocolString('not a reverse forwarding command')}`);
  }

  // ---- root: / tcp: ----

  private async root(s: FakeDeviceStream): Promise<void> {
    await s.send(this.rootResponse);
    s.close();
    if (this.rootResponse.startsWith('restarting')) {
      this.isRoot = true;
      this.onAdbdRestart();
    }
  }

  /** 기기 쪽 TCP 서버 흉내: 받은 데이터를 대문자로 돌려준다. */
  private async upperEcho(s: FakeDeviceStream): Promise<void> {
    for (;;) {
      const chunk = await s.readBytes(1);
      if (!chunk) return;
      await s.send(chunk.toString().toUpperCase());
    }
  }
}

function sendShell(s: FakeDeviceStream, id: number, payload: string | Buffer): Promise<void> {
  const body = typeof payload === 'string' ? Buffer.from(payload, 'utf-8') : payload;
  const header = Buffer.alloc(5);
  header.writeUInt8(id, 0);
  header.writeUInt32LE(body.length, 1);
  return s.send(Buffer.concat([header, body]));
}

function sendSync(s: FakeDeviceStream, id: string, payload: string | Buffer = Buffer.alloc(0)): Promise<void> {
  const body = typeof payload === 'string' ? Buffer.from(payload, 'utf-8') : payload;
  const header = Buffer.alloc(8);
  header.write(id, 0, 4, 'ascii');
  header.writeUInt32LE(id === 'DONE' || id === 'OKAY' ? 0 : body.length, 4);
  return s.send(id === 'DONE' || id === 'OKAY' ? header : Buffer.concat([header, body]));
}
