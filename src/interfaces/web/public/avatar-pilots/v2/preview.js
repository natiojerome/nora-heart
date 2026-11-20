'use strict';
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
let paused=false;
function update(){
 const fixed=paused||reduced.matches||document.hidden;
 for(const image of document.querySelectorAll('img[data-id]')){
  const suffix=fixed||image.dataset.failed==='yes'?'png':'webp';
  const next=`./${image.dataset.id}-${image.dataset.kind}.${suffix}`;
  if(image.getAttribute('src')!==next)image.src=next;
 }
 const button=document.getElementById('pause');button.textContent=fixed?'Lire les animations':'Mettre en pause';button.setAttribute('aria-pressed',String(paused));button.disabled=reduced.matches;
}
for(const image of document.querySelectorAll('img[data-id]'))image.addEventListener('error',()=>{image.dataset.failed='yes';update();});
document.getElementById('pause').addEventListener('click',()=>{paused=!paused;update();});
document.getElementById('theme').addEventListener('click',event=>{const dark=document.body.classList.toggle('dark');event.currentTarget.textContent=dark?'Fond clair':'Fond sombre';event.currentTarget.setAttribute('aria-pressed',String(dark));});
reduced.addEventListener('change',update);document.addEventListener('visibilitychange',update);update();
