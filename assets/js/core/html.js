// Plantillas HTML seguras (único sumidero de innerHTML: setHtml).
export const esc = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// ── Plantillas HTML seguras ──
// html`...` escapa cada interpolación con esc() salvo SafeHtml (se inserta tal cual) o arrays (se procesan y concatenan).
// setHtml() es el ÚNICO sumidero de innerHTML y rechaza strings planos.
export class SafeHtml{ constructor(s){ this.s=s; } toString(){ return this.s; } }
export const raw=s=>new SafeHtml(String(s));
function htmlPart(v){
  if(v==null||v===false) return '';
  if(v instanceof SafeHtml) return v.s;
  if(Array.isArray(v)) return v.map(htmlPart).join('');
  return esc(v);
}
export function html(strings,...vals){
  let out=strings[0];
  vals.forEach((v,i)=>{ out+=htmlPart(v)+strings[i+1]; });
  return new SafeHtml(out);
}
export const joinHtml=arr=>new SafeHtml(htmlPart(arr)); // array de SafeHtml/strings -> SafeHtml
export function setHtml(el,safe){
  if(!(safe instanceof SafeHtml)) throw new TypeError('setHtml requiere SafeHtml (usar html`...`)');
  // eslint-disable-next-line no-unsanitized/property -- único sumidero; recibe SafeHtml
  el.innerHTML=safe.toString();
}
export const safeCls = s => String(s==null?'':s).toLowerCase().replace(/[^a-z0-9_-]/g,'');
