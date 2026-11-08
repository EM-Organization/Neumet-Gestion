// Constantes del arnés E2E. TODO es de prueba y de baja entropía a propósito: no hay secretos reales.
export const JWT_SECRET = 'secreto-de-prueba-local-'.repeat(2) + 'e2e'; // >= 32 caracteres (mínimo de PostgREST)
export const DB_NAME = 'neumet_e2e';
export const AUTHENTICATOR_PASSWORD = 'authenticator-de-prueba';
export const POSTGREST_VERSION = 'v16.5';
// Binarios oficiales de PostgREST (release v16.5 del repositorio PostgREST/postgrest) con su SHA-256.
export const POSTGREST_ASSETS = {
  'darwin-arm64': { file: 'postgrest-v16.5-macos-aarch64.tar.xz', sha256: 'd8095cb439de0a3151036df542139e7afca5cebb109ce7f1bae52b3a97e9846a' },
  'darwin-x64': { file: 'postgrest-v16.5-macos-x86-64.tar.xz', sha256: 'dd4d346cd65dba4863ae02686fd09d2e34bbb6889e05d8ff7f1ac42ba0939515' },
  'linux-x64': { file: 'postgrest-v16.5-linux-static-x86-64.tar.xz', sha256: '5099e7ada38f9f6846cd87c14c5f158b7c165f1e9959665ad412e61f4dceba95' },
  'linux-arm64': { file: 'postgrest-v16.5-linux-static-aarch64.tar.xz', sha256: '96d75a34c7c095d5f97b87f88042f898192724350861328db9e1509e696ea057' }
};
// Usuarios de prueba (UUID fijos; los perfiles se crean en sql/).
export const USERS = {
  admin: { sub: 'e2e00000-0000-0000-0000-000000000001', email: 'admin@e2e.test' },
  global: { sub: 'e2e00000-0000-0000-0000-000000000002', email: 'demo-global@e2e.test' },
  salto: { sub: 'e2e00000-0000-0000-0000-000000000003', email: 'demo-salto@e2e.test' },
  sinperfil: { sub: 'e2e00000-0000-0000-0000-000000000006', email: 'sin-perfil@e2e.test' },
  api: { sub: 'e2e00000-0000-0000-0000-000000000007', email: 'api@e2e.test' },
  otra: { sub: 'e2e00000-0000-0000-0000-000000000005', email: 'otra@e2e.test' },
  montevideo: { sub: 'e2e00000-0000-0000-0000-000000000004', email: 'demo-montevideo@e2e.test' }
};
