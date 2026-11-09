// Configuración del diálogo de confirmación (puro, sin DOM). La etiqueta y la intención son obligatorias:
// un default «Eliminar» en rojo llegó a mostrarse en acciones no destructivas (intercambio de neumáticos).
export function configDialogo(title, msg, okLabel, danger) {
  if (typeof okLabel !== 'string' || !okLabel.trim()) throw new Error('confirmDialog: falta la etiqueta del botón');
  if (typeof danger !== 'boolean') throw new Error('confirmDialog: falta indicar si la acción es destructiva');
  return {
    title: String(title ?? ''), msg: String(msg ?? ''), okLabel: okLabel.trim(), danger,
    okClass: danger ? 'danger' : 'primary',
    iconClass: danger ? 'danger' : 'neutral',
    icono: danger ? 'papelera' : 'intercambio',
  };
}
