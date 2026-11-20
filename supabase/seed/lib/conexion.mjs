// Conexión de la carga a Postgres. La contraseña NUNCA va en los argumentos de psql (se ve en `ps` y en el historial):
// se pasa por las variables PG* del proceso hijo. Dos formas de configurarla, sin imprimir nada:
//   - NEUMET_DB_URL (cadena postgresql://usuario:clave@host:puerto/base[?sslmode=..]): se descompone en PGHOST, PGPORT,
//     PGUSER, PGPASSWORD, PGDATABASE y PGSSLMODE;
//   - o las variables PG* de siempre (PGHOST, PGUSER, PGPASSWORD, PGDATABASE, PGSERVICE, ~/.pgpass), tal cual.

/** Argumentos fijos de psql: ninguno lleva la conexión (esa va por entorno). El SQL entra por la entrada estándar. */
export const ARGS_PSQL = ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-f', '-'];

/** Entorno del proceso psql, o null si no hay base configurada. Lanza sin eco de la cadena si NEUMET_DB_URL es inválida. */
export function entornoPsql(env) {
  const { NEUMET_DB_URL: cadena, ...resto } = env;
  if (cadena) {
    let u;
    try { u = new URL(cadena); } catch { throw new Error('NEUMET_DB_URL no es una cadena de conexión válida (no se imprime por seguridad)'); }
    if (!/^postgres(ql)?:$/.test(u.protocol)) throw new Error('NEUMET_DB_URL debe empezar con postgresql://');
    const dec = (x) => decodeURIComponent(x);
    const sal = { ...resto };
    const host = u.searchParams.get('host') || u.hostname; // ?host=/ruta/socket para un socket Unix
    if (host) sal.PGHOST = dec(host);
    if (u.port) sal.PGPORT = u.port;
    if (u.username) sal.PGUSER = dec(u.username);
    if (u.password) sal.PGPASSWORD = dec(u.password);
    if (u.pathname.length > 1) sal.PGDATABASE = dec(u.pathname.slice(1));
    if (u.searchParams.get('sslmode')) sal.PGSSLMODE = u.searchParams.get('sslmode');
    return sal;
  }
  if (env.PGSERVICE || env.PGHOST || env.PGDATABASE) return { ...resto };
  return null;
}

/** Quita de un texto (mensajes de error) cualquier valor secreto de la conexión, por si psql lo repitiera. */
export function sinSecretos(texto, env) {
  let t = String(texto ?? '');
  for (const s of [env.PGPASSWORD, env.NEUMET_DB_URL]) if (s) t = t.split(s).join('<oculto>');
  return t;
}
