'use strict';
const pack = window.NORA_AVATAR_PACK;
const avatarName=pack.displayName;
document.title=`${avatarName} · Pack avatar animé`;
const $ = id => document.getElementById(id);
const labels = { idle: 'Au repos', working: 'Travaille', waiting: 'Attend une réponse' };
const statusText = { idle: `${avatarName} se repose`, working: `${avatarName} travaille`, waiting: `${avatarName} attend une réponse` };
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
let playing = !reduced.matches, state = 'working', generation = 0;
const observers = new Map();
const timers = new Set();
function imageUrl(kind, current, size, animated) { return `./${kind}/${current}-${size}.${animated ? 'webp' : 'png'}`; }
function animateAllowed() { return playing && !reduced.matches && !document.hidden; }
function updateImage(image) {
  if (image.dataset.transition === 'yes') return;
  const animated = animateAllowed() && observers.get(image) !== false && image.dataset.animationFailed !== "yes";
  const url = imageUrl(image.dataset.kind, state, Number(image.dataset.size), animated);
  if (image.getAttribute('src') !== url) image.src = url;
  image.alt = `${labels[state]} · ${avatarName} · ${image.dataset.size} px`;
}
const observer = new IntersectionObserver(entries => {
  for (const entry of entries) { observers.set(entry.target,entry.isIntersecting); updateImage(entry.target); }
});
function register(image, kind, size) {
  image.dataset.kind = kind; image.dataset.size = String(size);
  image.addEventListener('error',()=>{
    if (image.getAttribute('src')?.endsWith('.webp')) {
      image.dataset.transition=''; image.dataset.animationFailed='yes'; image.onload=null; updateImage(image);
    }
  });
  observer.observe(image); updateImage(image);
}
function updateAll() {
  document.querySelectorAll('img[data-kind]').forEach(updateImage);
  $('pause').textContent = playing && !reduced.matches ? 'Mettre en pause' : 'Activer les animations';
  $('pause').setAttribute('aria-pressed',String(!playing));
  $('pause').disabled = reduced.matches;
  $('motion-note').textContent = reduced.matches ? 'Réduction des mouvements activée sur cet appareil : images fixes.' : 'État simulé pour cet aperçu. Aucun modèle n’est appelé.';
}
function cancelTransitions() {
  generation++;
  for (const timer of timers) clearTimeout(timer);
  timers.clear();
  document.querySelectorAll('[data-transition]').forEach(image => { image.dataset.transition = ''; image.onload = null; });
}
function transition(image, kind, size, previous, next) {
  const asset = pack.files.find(file => file.path === `transitions/${previous}-to-${next}-${kind}-${size}.webp`);
  if (!asset || !animateAllowed()) return updateImage(image);
  const token = generation;
  image.dataset.transition = 'yes';
  image.onload = () => {
    image.onload = null;
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (token !== generation) return;
      image.dataset.transition = ''; updateImage(image);
    },asset.durationMs);
    timers.add(timer);
  };
  image.src = './'+asset.path;
}
for (const size of pack.portraitSizes) {
  const card = document.createElement('div'); card.className = 'size-item';
  const stage = document.createElement('div'); stage.className = 'size-stage';
  const image = document.createElement('img'); image.width=size; image.height=size; stage.append(image);
  const title = document.createElement('strong'); title.textContent = `${size} × ${size} px`;
  const text = document.createElement('p'); text.textContent = size <= 64 ? 'Petite icône · 8 i/s' : 'Portrait · 12 i/s';
  card.append(stage,title,text); $('sizes').append(card); register(image,'portrait',size);
}
for (const current of pack.states) {
  const card=document.createElement('div'),image=document.createElement('img'),text=document.createElement('p');
  image.src=imageUrl('portrait',current,96,false);image.alt=`Image fixe : ${labels[current]}`;image.width=96;image.height=96;
  text.textContent=labels[current];card.append(image,text);$('posters').append(card);
}
register($('main-portrait'),'portrait',256);
register($('main-body'),'body',512);
for (const button of document.querySelectorAll('[data-state]')) button.addEventListener('click',() => {
  const previous=state,next=button.dataset.state;if(previous===next)return;
  cancelTransitions();state=next;
  document.querySelectorAll('[data-state]').forEach(node=>{node.classList.toggle('selected',node===button);node.setAttribute('aria-pressed',String(node===button));});
  $('current-label').textContent=labels[state];$('status-text').textContent=statusText[state];
  transition($('main-portrait'),'portrait',256,previous,next);
  transition($('main-body'),'body',512,previous,next);
  updateAll();
});
$('pause').addEventListener('click',()=>{cancelTransitions();playing=!playing;updateAll();});
$('theme').addEventListener('click',()=>{const dark=document.body.classList.toggle('dark');$('theme').textContent=dark?'Fond clair':'Fond sombre';$('theme').setAttribute('aria-pressed',String(dark));});
reduced.addEventListener('change',()=>{cancelTransitions();updateAll();});
document.addEventListener('visibilitychange',()=>{cancelTransitions();updateAll();});
function mib(bytes){return `${(bytes/1024/1024).toLocaleString('fr-FR',{maximumFractionDigits:1})} Mo`;}
$('portrait-bytes').textContent=pack.downloads?.portraits?`· ${mib(pack.downloads.portraits)}`:'';
$('pack-bytes').textContent=pack.downloads?.complete?`· ${mib(pack.downloads.complete)}`:'';
updateAll();

document.querySelector("h1").textContent=`${avatarName} prend vie.`;
$("status-text").textContent=statusText[state];
