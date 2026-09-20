import { useCallback, useState } from 'react';
import type { OpenProject } from '@shared/project';
import type { CapturedExchange } from '@shared/capture';

interface UseProjectResult {
  project: OpenProject | undefined;
  createProject: (name: string) => Promise<void>;
  openProject: () => Promise<void>;
  saveCapture: (name: string, exchanges: CapturedExchange[]) => Promise<void>;
  loadCapture: (name: string) => Promise<CapturedExchange[]>;
  /** 시나리오 목록에 추가(저장 반영). */
  addScenarioName: (name: string) => void;
  /** 시나리오 목록에서 제거(삭제 반영). */
  removeScenarioName: (name: string) => void;
}

/** 열린 프로젝트 상태와 캡처 세션 저장/로드를 관리하는 훅. */
export function useProject(): UseProjectResult {
  const [project, setProject] = useState<OpenProject | undefined>(undefined);

  const createProject = useCallback(async (name: string) => {
    const result = await window.mokerApi.project.create(name);
    if (result) setProject(result);
  }, []);

  const openProject = useCallback(async () => {
    const result = await window.mokerApi.project.open();
    if (result) setProject(result);
  }, []);

  const saveCapture = useCallback(
    async (name: string, exchanges: CapturedExchange[]) => {
      const savedName = await window.mokerApi.project.saveCapture(name, exchanges);
      // 세션 목록에 반영.
      setProject((prev) =>
        prev
          ? {
              ...prev,
              captureSessions: prev.captureSessions.includes(savedName)
                ? prev.captureSessions
                : [...prev.captureSessions, savedName].sort()
            }
          : prev
      );
    },
    []
  );

  const loadCapture = useCallback(
    (name: string) => window.mokerApi.project.loadCapture(name),
    []
  );

  const addScenarioName = useCallback((name: string) => {
    setProject((prev) =>
      prev
        ? {
            ...prev,
            scenarios: prev.scenarios.includes(name)
              ? prev.scenarios
              : [...prev.scenarios, name].sort()
          }
        : prev
    );
  }, []);

  const removeScenarioName = useCallback((name: string) => {
    setProject((prev) =>
      prev ? { ...prev, scenarios: prev.scenarios.filter((s) => s !== name) } : prev
    );
  }, []);

  return {
    project,
    createProject,
    openProject,
    saveCapture,
    loadCapture,
    addScenarioName,
    removeScenarioName
  };
}
