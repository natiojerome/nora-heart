/* LaTeX stays in the journal; only the chat presentation uses KaTeX. */
(() => {
  let loading, ready=false;
  const records=new WeakMap();
  const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const escaped=(source,index)=>{let count=0;while(index>0&&source[--index]==='\\')count++;return count%2===1;};
  function match(source,block=false){
    const indent=block?source.match(/^ {0,3}/)[0].length:0,rest=source.slice(indent);
    const left=['$$','\\[',...(!block?['\\(','$']:[])].find(left=>rest.startsWith(left));if(!left)return;
    if(left==='$'&&(rest.startsWith('$$')||!rest[1]||/\s/.test(rest[1])))return;
    const right=left==='\\['?'\\]':left==='\\('?'\\)':left;
    let depth=0;
    for(let index=left.length;index<rest.length;index++){
      if(escaped(rest,index))continue;
      if(rest.startsWith(right,index)&&depth===0){
        if(left==='$'&&(/\s/.test(rest[index-1])||/\d/.test(rest[index+1]||'')||rest[index+1]==='$'))continue;
        const tex=rest.slice(left.length,index);if(!tex.trim())return;
        const raw=source.slice(0,indent+index+right.length);
        return {raw,tex,display:left!=='$'&&left!=='\\('};
      }
      if(rest[index]==='{')depth++;else if(rest[index]==='}')depth=Math.max(0,depth-1);
      if(left==='$'&&rest[index]==='\n')return;
    }
  }
  function start(source,block){
    const pattern=block?/(?:^|\n) {0,3}(?:\$\$|\\\[)/g:/\$\$|\\\[|\\\(|\$/g;
    for(const item of source.matchAll(pattern)){
      const index=item.index+(block&&item[0].startsWith('\n')?1:0);
      if(escaped(source,index)||(!block&&source[index]==='$'&&/[\w$]/.test(source[index-1]||'')))continue;
      if(match(source.slice(index),block))return index;
    }
  }
  function assets(){
    if(!loading){
      const load=(tag,attributes)=>new Promise((resolve,reject)=>{const node=document.createElement(tag);Object.assign(node,attributes);node.onload=resolve;node.onerror=()=>{node.remove();reject(new Error('Math assets unavailable'));};document.head.append(node);});
      loading=Promise.all([load('link',{rel:'stylesheet',href:'/vendor/katex/katex.min.css'}),load('script',{src:'/vendor/katex/katex.min.js'})]).then(()=>{ready=true;},()=>{loading=null;throw new Error('Math assets unavailable');});
    }
    return loading;
  }
  function renderFormula(node,token){
    if(!node.hasAttribute('data-heart-math'))return;
        try{window.katex.render(token.tex,node,{displayMode:token.display,throwOnError:true,trust:false,strict:'ignore',macros:{},output:'htmlAndMathml'});}
        catch{node.textContent=token.raw;node.classList.add('math-error');node.title='Formule non reconnue : source LaTeX conservée.';}
        node.removeAttribute('data-heart-math');node.removeAttribute('data-math-index');
  }
  function clone(source,target){
    const originals=[...(source.querySelectorAll?.('[data-heart-math]')||[])],copies=[...(target.querySelectorAll?.('[data-heart-math]')||[])];
    originals.forEach((node,index)=>{const token=records.get(node),copy=copies[index];if(!token||!copy)return;records.set(copy,token);if(ready)renderFormula(copy,token);else assets().then(()=>renderFormula(copy,token),()=>{});});
  }
  function create(){
    const nonce=window.heartPlatform.uuid(),formulas=[];
    const extensions=[true,false].map(block=>{const type=block?'heartMathBlock':'heartMathInline';return {
      name:type,level:block?'block':'inline',
      start(source){return start(source,block);},
      tokenizer(source){const found=match(source,block);if(found)return {type,...found};},
      renderer(token){const index=formulas.push(token)-1,tag=block?'div':'span';return `<${tag} class="chat-math ${token.display?'math-display':'math-inline'}" dir="ltr" data-heart-math="${nonce}" data-math-index="${index}">${escape(token.raw)}</${tag}>`;},
    };});
    function nodes(root){const selector=`[data-heart-math="${nonce}"]`;return new Set([...root.querySelectorAll(selector),...document.querySelectorAll(selector)]);}
    function renderNow(root){
      for(const node of nodes(root)){
        const token=formulas[Number(node.dataset.mathIndex)];if(!token)continue;
        renderFormula(node,token);
      }
      document.fonts.ready.then(()=>window.heartChat?.contentLoaded());
    }
    return {extensions,render(root){
      if(!formulas.length)return;
      for(const node of nodes(root)){const token=formulas[Number(node.dataset.mathIndex)];if(token)records.set(node,token);}
      if(ready){renderNow(root);return;}
      assets().then(()=>renderNow(root),()=>{for(const node of nodes(root)){node.classList.add('math-error');node.title='Affichage mathématique indisponible. Source conservée ; recharge la page.';}});
    }};
  }
  window.heartMath={create,clone};
})();
