/// <reference types="vite/client" />

// Vite의 ?worker suffix import에 대한 타입 선언.
declare module '*?worker' {
  const workerConstructor: {
    new (): Worker;
  };
  export default workerConstructor;
}
