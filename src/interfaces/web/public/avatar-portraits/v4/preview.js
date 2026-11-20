const media=matchMedia('(prefers-reduced-motion: reduce)');
let paused=media.matches;
const pause=document.querySelector('#pause'),theme=document.querySelector('#theme'),size=document.querySelector('#size');
function render(){for(const img of document.querySelectorAll('[data-id]')){img.src=`./${img.dataset.id}-${size.value}.${paused?'png':'webp'}`;img.width=Number(size.value);img.height=Number(size.value);}pause.textContent=paused?'Animer':'Mettre en pause';pause.setAttribute('aria-pressed',String(paused));}
pause.addEventListener('click',()=>{paused=!paused;render();});
size.addEventListener('change',render);
media.addEventListener('change',event=>{paused=event.matches;render();});
theme.addEventListener('click',()=>{const dark=document.body.classList.toggle('dark');theme.setAttribute('aria-pressed',String(dark));theme.textContent=dark?'Fond clair':'Fond sombre';});
for(const img of document.querySelectorAll('[data-id]'))img.addEventListener('error',()=>{if(!img.src.endsWith('.png'))img.src=`./${img.dataset.id}-${size.value}.png`;});
render();
