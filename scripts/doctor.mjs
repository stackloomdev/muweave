const major = Number(process.versions.node.split('.')[0]);
console.log(major >= 22 ? 'Node is ready for development/builds.' : 'Use Node.js 22.12+ to build.');
console.log(
  'Published app: static files only. No Node service, native FFmpeg, or headless browser required.',
);
console.log(
  'Browser: IndexedDB, Canvas, Web Audio, WebAssembly and Web Workers. Use HTTPS or localhost.',
);
process.exitCode = major >= 22 ? 0 : 1;
