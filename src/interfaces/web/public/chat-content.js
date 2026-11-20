/* Markdown presentation, independent of models and persistence. */
(() => {
  const imagePath = /\.(png|jpe?g|webp|gif|avif|svg)(?:[?#]|$)/i;
  let viewer;
  const node = (tag, text, cls) => {
    const item = document.createElement(tag);
    if (text !== undefined) item.textContent = text;
    if (cls) item.className = cls;
    return item;
  };
  function icon(name) {
    const item = node('span'); item.dataset.icon = name; item.setAttribute('aria-hidden', 'true');
    window.heartUI?.renderIcons(item); return item;
  }
  function button(label, name, action) {
    const item = node('button', undefined, 'content-action'); item.type = 'button';
    item.append(icon(name), node('span', label)); item.addEventListener('click', action); return item;
  }
  function resolve(href, context) {
    if (!href || href.startsWith('#') || href.startsWith('//')) return null;
    if (/^https?:/i.test(href)) {
      try { const url = new URL(href); return url.protocol === 'https:' && url.origin !== location.origin ? {external:true, src:url.href, download:url.href} : null; }
      catch { return null; }
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || !context.conversationId) return null;
    let path;
    try { path = decodeURIComponent(href.split(/[?#]/)[0]).replace(/:\d+(?::\d+)?$/, '').replaceAll('\\', '/'); }
    catch { return null; }
    if (path.includes('\0')) return null;
    if (context.workspaceRoot && path.startsWith(context.workspaceRoot + '/')) path = path.slice(context.workspaceRoot.length + 1);
    else if (path.startsWith('/workspace/')) path = path.slice(11);
    else if (path.startsWith('/')) return null;
    const parts = [];
    for (const part of path.split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') { if (!parts.length) return null; parts.pop(); }
      else parts.push(part);
    }
    if (!parts.length) return null;
    path = parts.join('/');
    const base = `/api/conversations/${encodeURIComponent(context.conversationId)}/workspace/`;
    return {path, src:base+'preview?path='+encodeURIComponent(path), download:base+'raw?path='+encodeURIComponent(path)};
  }
  function dialog(title, subtitle) {
    const previous = viewer?.returnFocus || document.activeElement;
    viewer?.close();
    viewer = node('dialog', undefined, 'content-viewer');
    viewer.returnFocus = previous;
    const current = viewer, heading = node('header', undefined, 'content-viewer-heading');
    const titleBox = node('div'); const titleNode = node('h2', title); titleNode.id = 'content-viewer-title';
    titleBox.append(titleNode, node('p', subtitle)); current.setAttribute('aria-labelledby', titleNode.id);
    const actions = node('div', undefined, 'content-actions');
    actions.append(button('Fermer', 'close', () => current.close())); heading.append(titleBox, actions);
    const body = node('div', undefined, 'content-viewer-body'); current.append(heading, body); document.body.append(current);
    current.addEventListener('close', () => {current.remove(); if(viewer===current){viewer=null;if(previous?.isConnected)previous.focus({preventScroll:true});}}, {once:true});
    current.addEventListener('click', event => { if(event.target===current){const box=current.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)current.close();} });
    current.showModal(); return {current, body, actions};
  }
  function cellText(cell){
    const copy=cell.cloneNode(true);
    for(const formula of copy.querySelectorAll('.chat-math')){const source=formula.querySelector('annotation[encoding="application/x-tex"]');if(source)formula.replaceWith(document.createTextNode(source.textContent));}
    return copy.textContent.trim();
  }
  function tableData(table) {
    const headers = [...table.querySelectorAll('thead th')];
    const rows = [...table.querySelectorAll('tbody tr')].map(row => [...row.children]);
    return {headers, rows};
  }
  function cards(data, rows = data.rows) {
    const list = node('div', undefined, 'content-table-cards');
    for (const row of rows) {
      const card = node('dl', undefined, 'content-table-card');
      row.forEach((cell, index) => {const field=node('div');const label=node('dt'),header=data.headers[index];if(header)label.append(...[...header.childNodes].map(child=>child.cloneNode(true)));else label.textContent=`Colonne ${index+1}`;field.append(label);const value=node('dd');value.dir='auto';value.append(...[...cell.childNodes].map(child=>child.cloneNode(true)));field.append(value);card.append(field);});
      list.append(card);
    }
    return list;
  }
  function table(table, context) {
    const template=table.cloneNode(true);window.heartMath?.clone(table,template);
    const data = tableData(template), summary = `${data.rows.length} ligne${data.rows.length>1?'s':''} · ${data.headers.length || table.rows[0]?.cells.length || 0} colonnes`;
    const shell=node('div',undefined,'content-table'), toolbar=node('div',undefined,'content-toolbar');
    const info=node('span',summary,'content-caption'); info.prepend(icon('table'));
    const open=button('Agrandir','expand',()=>{
      const modal=dialog('Tableau',summary), tabs=node('div',undefined,'content-modes'); tabs.setAttribute('role','group');tabs.setAttribute('aria-label','Affichage du tableau');
      const render=mode=>{modal.body.replaceChildren();modal.body.classList.toggle('cards',mode==='cards');for(const child of tabs.children)child.setAttribute('aria-pressed',String(child.dataset.mode===mode));
        if(mode==='cards')modal.body.append(cards(data));else {const scroller=node('div',undefined,'content-table-scroll');scroller.tabIndex=0;scroller.append(template.cloneNode(true));modal.body.append(scroller);}enhanceLinks(modal.body,context);};
      for(const [mode,label,name] of [['cards','Cartes','cards'],['table','Tableau','table']]){const item=button(label,name,()=>render(mode));item.dataset.mode=mode;tabs.append(item);}
      modal.current.insertBefore(tabs,modal.body);render(matchMedia('(max-width:679px)').matches?'cards':'table');
      modal.actions.prepend(button('Copier','copy',async event=>{const target=event.currentTarget;try{await window.heartChat.copyText([data.headers.map(cellText),...data.rows.map(row=>row.map(cellText))].map(row=>row.join('\t')).join('\n'));target.querySelector('span:last-child').textContent='Copié';}catch{message('Copie indisponible.',true);}}));
    });
    toolbar.append(info,open);table.replaceWith(shell);const scroll=node('div',undefined,'content-table-scroll message-table');scroll.tabIndex=0;scroll.setAttribute('role','region');scroll.setAttribute('aria-label','Tableau, défilement horizontal');scroll.append(table);shell.append(toolbar,scroll);
    const preview=cards(data,data.rows.slice(0,2));preview.classList.add('content-table-preview');shell.append(preview);
    if(data.rows.length>2)preview.append(node('small',`+ ${data.rows.length-2} autres lignes · Agrandir`));
  }
  function image(link, source, label) {
    const shell=node('figure',undefined,'content-image'), toolbar=node('figcaption',undefined,'content-toolbar');
    const caption=node('span',label,'content-caption');caption.prepend(icon('image'));
    const actions=node('div',undefined,'content-actions'), body=node('div',undefined,'content-image-body');
    let loaded=false, shown=false;
    const show=()=>{
      shown=true;body.replaceChildren();toggle.querySelector('span:last-child').textContent='Masquer';
      const preview=button('Agrandir l’image','expand',()=>{if(!loaded)return;const modal=dialog(label,source.external?'Image externe':'Image du fil');const full=node('img');full.alt=label;full.src=source.src;modal.body.classList.add('content-full-image');modal.body.append(full);});preview.className='content-image-preview';preview.replaceChildren();preview.setAttribute('aria-label',`Agrandir ${label}`);
      const img=node('img');img.alt=label;img.loading='lazy';img.decoding='async';img.referrerPolicy='no-referrer';
      const status=node('span','Chargement…','content-image-status');status.setAttribute('role','status');
      img.addEventListener('load',()=>{loaded=true;status.remove();window.heartChat?.contentLoaded();},{once:true});
      img.addEventListener('error',()=>{loaded=false;preview.remove();status.textContent='Image indisponible.';body.append(button('Réessayer','refresh',show));window.heartChat?.contentLoaded();},{once:true});
      img.src=source.src;preview.append(img);body.append(status,preview);
    };
    const toggle=button('Afficher','eye',()=>{if(shown){shown=false;body.replaceChildren(button('Afficher l’image','image',show));toggle.querySelector('span:last-child').textContent='Afficher';}else show();});
    const download=node('a',undefined,'content-action');download.href=source.download;download.download=source.path?.split('/').at(-1)||label;download.append(icon('download'),node('span','Télécharger'));
    if(source.external){download.target='_blank';download.rel='noopener noreferrer';download.referrerPolicy='no-referrer';}
    actions.append(download,toggle);toolbar.append(caption,actions);shell.append(toolbar,body);link.replaceWith(shell);
    if(source.external){body.append(node('small','Image externe'),button('Afficher l’image','image',show));}else show();
  }
  function enhanceLinks(root, context) {
      for (const link of root.querySelectorAll('a')) {
        const href=link.getAttribute('href'), source=resolve(href,context), wantsImage=link.dataset.imageRef==='true'||imagePath.test(href||'');
        if(wantsImage && source){image(link,source,link.textContent.trim()||source.path?.split('/').at(-1)||'Image');continue;}
        if(source?.path){link.dataset.workspaceLink=source.path;link.dataset.conversationId=context.conversationId;link.href=source.download;link.removeAttribute('target');link.classList.add('content-file-link');link.prepend(icon('files'));}
        else if(href && !/^https?:|^mailto:/i.test(href))link.removeAttribute('href');
      }
  }
  // Delegation also handles links cloned into table cards/fullscreen views.
  document.addEventListener('click',event=>{
    const link=event.target.closest?.('a[data-workspace-link]');if(!link)return;event.preventDefault();
    viewer?.close();void window.heartWorkspace?.openFile(link.dataset.workspaceLink,link.dataset.conversationId);
  });
  window.heartContent = {
    enhance(root, context) {
      root.querySelectorAll('table').forEach(item=>table(item,context));
      enhanceLinks(root,context);
    },
    close(){viewer?.close();},
  };
})();
