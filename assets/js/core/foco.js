// Devuelve el foco tras una acción que repinta la pantalla (recarga de filas, cierre de un modal): el repintado destruye el
// elemento enfocado y el foco cae en <body>, de modo que el teclado empieza otra vez desde arriba.
// Solo actúa si el foco quedó huérfano (body, nada o un nodo ya desconectado): si el operario ya puso el foco en otro control
// vivo mientras la operación estaba en curso, no se le quita. Los destinos se buscan DESPUÉS del repintado, por selector
// (nunca por referencia a un nodo viejo); se enfoca el primero que exista y esté visible. Sin estado: función pura sobre el DOM.
export function devolverFoco(...selectores) {
  const a = document.activeElement;
  if (a && a !== document.body && a.isConnected) return false;
  for (const s of selectores) {
    if (!s) continue;
    const el = document.querySelector(s);
    if (el && el.getClientRects().length) { el.focus(); return true; }
  }
  return false;
}
