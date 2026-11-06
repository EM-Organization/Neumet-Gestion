// Paleta de marca para SVG generados por JS (var() no es fiable en atributos SVG).
export const BRAND=(()=>{
  let cs=null; try{ cs=getComputedStyle(document.documentElement); }catch(_e){ /* sin estilos: se usan los hex de respaldo */ }
  const g=(n,fb)=>((cs&&cs.getPropertyValue(n))||'').trim()||fb;
  return {
    ink:g('--accent-dark','#383424'), accent:g('--accent','#D5C58A'),
    textSecondary:g('--text-secondary','#615A3F'), textTertiary:g('--text-tertiary','#908C79'),
    bg:g('--bg','#EBEBEB'), surface:g('--surface','#FFFFFF')
  };
})();
