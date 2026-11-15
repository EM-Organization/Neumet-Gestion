// Tope de intentos por llamante en una ventana deslizante (docs/17 §4.2: encarece la enumeración de cuentas por el 409).
// Es en memoria de la instancia: no suma entre instancias ni sobrevive a un reinicio, así que acota pero no garantiza;
// un contador durable necesita una tabla (migración) y queda como pendiente declarado en docs/10.

export function crearLimite(max: number, ventanaMs: number, ahora: () => number = Date.now) {
  const porUsuario = new Map<string, number[]>();
  return (userId: string): boolean => {
    const t = ahora();
    const recientes = (porUsuario.get(userId) ?? []).filter((x) => t - x < ventanaMs);
    if (recientes.length >= max) {
      porUsuario.set(userId, recientes);
      return false;
    }
    recientes.push(t);
    porUsuario.set(userId, recientes);
    // Sin esto el mapa crecería con cada usuario distinto que llame a lo largo de la vida de la instancia.
    if (porUsuario.size > 1000) {
      for (const [k, v] of porUsuario) if (v.every((x) => t - x >= ventanaMs)) porUsuario.delete(k);
    }
    return true;
  };
}
