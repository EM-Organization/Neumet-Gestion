// Crea un elemento SVG con atributos.
export function svgEl(t,a={}){ const e=document.createElementNS('http://www.w3.org/2000/svg',t); Object.entries(a).forEach(([k,v])=>e.setAttribute(k,v)); return e; }
