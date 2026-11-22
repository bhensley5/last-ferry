// One image, two independent transforms: travel moves the perch; gestures move Wick.
export function wishCompanion(editor, input, tip) {
  const courier = editor.querySelector('.wick-flight');
  const button = courier.querySelector('button');
  const intro = document.querySelector('#wick-intro');
  const quip = document.querySelector('#wick-quip');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  let flight, introTimer, settleTimer, quipTimer, introducing = false;
  let greeted = false;
  try { greeted = sessionStorage.getItem('last-ferry:met-wick') === 'yes'; } catch {}

  function dock(immediate = false) {
    if (!introducing) return;
    introducing = false;
    clearTimeout(introTimer);
    intro.hidden = true;
    editor.classList.remove('meeting-wick');
    const from = courier.style.transform;
    courier.style.transform = '';
    if (!immediate && !reduce.matches) {
      editor.querySelector('.wish-paper').animate([{transform:'scaleY(.84)',opacity:.65},{transform:'none',opacity:1}],
        {duration:390,delay:450,fill:'backwards',easing:'ease-out'});
      flight = courier.animate([{transform:from},{transform:'translate(-14px,-20px) rotate(9deg)',offset:.82},{transform:'none'}],
        {duration:760,easing:'cubic-bezier(.42,0,.18,1)'});
    }
  }
  function center() {
    const box = courier.parentElement.getBoundingClientRect();
    const x = innerWidth/2 - (box.left + box.width/2);
    const y = innerHeight/2 - 55 - (box.top + box.height/2);
    courier.style.transform = 'translate('+x+'px,'+y+'px) scale('+(innerHeight<480?1.25:1.8)+')';
  }
  function greet() {
    if (editor.dataset.busy) return;
    clearTimeout(introTimer);
    flight?.cancel();
    introducing = true;
    quip.hidden = true;
    editor.classList.add('meeting-wick');
    intro.hidden = false;
    center();
    introTimer = setTimeout(()=>dock(),2900);
    try { sessionStorage.setItem('last-ferry:met-wick','yes'); } catch {}
  }
  function whisper(text) {
    if (introducing || editor.dataset.busy || document.activeElement===input) return;
    clearTimeout(quipTimer);
    quip.textContent = text;
    quip.hidden = false;
    quipTimer = setTimeout(()=>{quip.hidden=true;},3500);
  }
  function state(name,message) {
    dock(true); quip.hidden = true;clearTimeout(settleTimer);
    editor.dataset.mood = name;
    tip.textContent = message;
    if (['granted','answered','error','cheer'].includes(name))
      settleTimer = setTimeout(()=>{editor.dataset.mood='idle';},2000);
  }
  button.addEventListener('click',()=>introducing?dock():greet());
  intro.querySelector('button').addEventListener('click',()=>{dock();document.querySelector('#game').focus();});
  window.addEventListener('resize',()=>{if(introducing)center();});
  window.addEventListener('keydown',event=>{if(introducing && !['Tab','Shift','Control','Alt','Meta'].includes(event.key))dock();});
  document.querySelector('#game').addEventListener('pointerdown',()=>dock());
  input.addEventListener('focus',()=>{dock(true);flight?.cancel();quip.hidden=true;});
  if (!greeted) greet();
  return {state,whisper,cheer(text){if(!editor.dataset.busy && !introducing){editor.dataset.mood='cheer';whisper(text);clearTimeout(settleTimer);settleTimer=setTimeout(()=>editor.dataset.mood='idle',1600);}}};
}
