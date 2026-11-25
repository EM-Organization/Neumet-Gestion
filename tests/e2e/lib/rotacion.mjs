// Rotar pide el motivo del catálogo y, si el cliente lo exige, el odómetro, en el diálogo «Rotar».
// Las pruebas que rotan confirman por aquí, así el motivo no queda implícito en cada una.
export async function confirmarRotacionEnDialogo(p, { motivo = 'swap_20000', odometro = null } = {}) {
  await p.click('#vd-rotar-btn');
  await p.esperar(`document.querySelector('#modal-rotar').classList.contains('show')`, { que: 'diálogo de rotar' });
  const campos = [['#rotar-motivo', motivo]];
  if (odometro !== null) campos.push(['#rotar-odo', String(odometro)]);
  await p.eval(`(() => { const set = (id, v) => { const e = document.querySelector(id); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); }; ${campos.map(([id, v]) => `set(${JSON.stringify(id)}, ${JSON.stringify(v)});`).join(' ')} })()`);
  await p.click('#rotar-confirmar');
}
