// Escrituras reales desde `desde` en env.peticiones. Varias pantallas leen con POST /rpc/<función> (PostgREST usa POST para las RPC), así que
// «método distinto de GET» no basta: el hook de login de Dispositivos lanza get_unregistered_devices y Inicio lanza ultimas_mediciones, y si
// llegan después de fijar `desde` (el orden depende de la velocidad del runner) contaban como escritura y el test era inestable.
// Lista explícita de RPC de lectura en vez de esperar a que se asienten: no depende de tiempos. Una RPC nueva que solo lee se agrega aquí;
// una escritura nunca debe estar en esta lista.
export const RPC_DE_LECTURA = ['ultimas_mediciones', 'get_unregistered_devices', 'uso_clientes_listar'];

export const escrituras = (env, desde) => env.peticiones.slice(desde).filter((r) => r.method !== 'GET' && r.method !== 'HEAD'
  && !RPC_DE_LECTURA.some((n) => r.path.split('?')[0] === `/rpc/${n}`));
