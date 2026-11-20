'use strict';
const canvas=document.getElementById('render'),ctx=canvas.getContext('2d',{willReadFrequently:true});
const tau=Math.PI*2;
const configurations={
 masculine:{atlas:'masculine-atlas.png',head:'masculine-head.png',body:[80,50,630,970],left:[815,405,240,610],right:[1260,400,220,610],headRect:null,headH:242,bodyH:410,shoulderX:89,shoulderY:349,armH:218,face:{eyesY:.56,eyesX:.155,eyeW:.058,eyeH:.036,mouthY:.75}},
 neutral:{atlas:'neutral-atlas.png',body:[40,225,710,790],left:[860,470,235,540],right:[1245,465,225,545],headRect:[800,0,710,460],headH:220,bodyH:352,shoulderX:104,shoulderY:372,armH:184,face:{eyesY:.48,eyesX:.17,eyeW:.075,eyeH:.095,mouthY:.7}}
};
let config,parts;
function load(name){return new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=reject;image.src='/assets/avatar-sources/'+name;});}
function extract(image,rect){
 const [x,y,w,h]=rect??[0,0,image.width,image.height];
 const source=document.createElement('canvas');source.width=w;source.height=h;const c=source.getContext('2d',{willReadFrequently:true});c.drawImage(image,x,y,w,h,0,0,w,h);
 const rgba=c.getImageData(0,0,w,h).data;let l=w,t=h,r=0,b=0;
 for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++)if(rgba[(yy*w+xx)*4+3]>22){l=Math.min(l,xx);r=Math.max(r,xx);t=Math.min(t,yy);b=Math.max(b,yy);}
 if(r<=l||b<=t)throw new Error('Empty rig part');
 const result=document.createElement('canvas');result.width=r-l+1;result.height=b-t+1;result.getContext('2d').drawImage(source,l,t,result.width,result.height,0,0,result.width,result.height);return result;
}
window.initAvatar=async type=>{
 config=configurations[type];if(!config)throw new Error('Unknown avatar');
 const atlas=await load(config.atlas),head=config.head?await load(config.head):atlas;
 parts={body:extract(atlas,config.body),head:extract(head,config.headRect),left:extract(atlas,config.left),right:extract(atlas,config.right)};
 return Object.fromEntries(Object.entries(parts).map(([name,image])=>[name,{width:image.width,height:image.height}]));
};
function pose(state,phase){
 const wave=Math.sin(tau*phase),pulse=Math.sin(tau*phase*2);
 const blink=1-.97*Math.exp(-Math.pow((phase-.68)/.025,2));
 if(state==='idle')return {tilt:-.075+.018*wave,headY:2.5*wave,eyeOpen:0,look:0,left:.09+.015*wave,right:-.09-.015*wave,keyboard:0,breathe:2*wave,smile:.3,yawn:.04*(1-Math.cos(tau*phase))};
 if(state==='working')return {tilt:.018*wave,headY:1.3*pulse,eyeOpen:blink,look:.014*wave,left:-.34+.035*Math.sin(tau*phase*6),right:.34+.035*Math.sin(tau*phase*6+Math.PI),keyboard:1,breathe:1.2*wave,smile:.1,yawn:0};
 return {tilt:.04*wave,headY:2*wave,eyeOpen:blink,look:.025*wave,left:.08,right:-2.2+.14*pulse,keyboard:0,breathe:1.5*wave,smile:.7,yawn:0};
}
function mix(a,b,amount){const result={};for(const key of Object.keys(a))result[key]=a[key]+(b[key]-a[key])*amount;return result;}
function part(image,x,y,height,angle=0,pivot=.5){
 const width=height*image.width/image.height;ctx.save();ctx.translate(x,y);ctx.rotate(angle);ctx.drawImage(image,-width/2,-height*pivot,width,height);ctx.restore();
}
function face(headW,headH,p,phase){
 const f=config.face,centerY=(f.eyesY-.5)*headH;
 ctx.save();ctx.translate(p.look*headW,0);ctx.strokeStyle='#69f2ff';ctx.fillStyle='#62ebff';ctx.lineCap='round';ctx.lineJoin='round';ctx.shadowColor='#22dcea';ctx.shadowBlur=5;
 for(const sign of [-1,1]){
  const x=sign*f.eyesX*headW,w=f.eyeW*headW,h=f.eyeH*headH;
  if(p.eyeOpen<.1){ctx.lineWidth=Math.max(2,headW*.012);ctx.beginPath();ctx.moveTo(x-w,centerY);ctx.quadraticCurveTo(x,centerY+h*.6,x+w,centerY);ctx.stroke();}
  else{
   ctx.beginPath();ctx.ellipse(x,centerY,w,Math.max(1.3,h*p.eyeOpen),0,0,tau);ctx.fill();
   ctx.shadowBlur=0;ctx.fillStyle='#efffff';ctx.beginPath();ctx.ellipse(x-w*.24,centerY-h*.25*p.eyeOpen,w*.28,h*.23*p.eyeOpen,0,0,tau);ctx.fill();ctx.fillStyle='#62ebff';ctx.shadowBlur=5;
  }
 }
 ctx.shadowBlur=2;ctx.lineWidth=Math.max(1.8,headW*.011);
 const y=(f.mouthY-.5)*headH;
 ctx.beginPath();
 if(p.yawn>.025){ctx.ellipse(0,y,headW*.035,headH*p.yawn*.45,0,0,tau);ctx.stroke();}
 else{ctx.moveTo(-headW*.075,y);ctx.quadraticCurveTo(0,y+headH*(.015+.025*p.smile),headW*.075,y);ctx.stroke();}
 if(p.keyboard>.5){ctx.shadowBlur=0;ctx.globalAlpha=.4;ctx.lineWidth=1;const scanY=centerY-headH*.11+((phase*2)%1)*headH*.22;ctx.beginPath();ctx.moveTo(-headW*.23,scanY);ctx.lineTo(headW*.23,scanY);ctx.stroke();}
 ctx.restore();
}
function head(x,y,height,p,phase){
 const width=height*parts.head.width/parts.head.height;
 ctx.save();ctx.translate(x,y+p.headY);ctx.rotate(p.tilt);ctx.drawImage(parts.head,-width/2,-height/2,width,height);face(width,height,p,phase);ctx.restore();
}
function keyboard(p,phase){
 if(p.keyboard<.01)return;
 ctx.save();ctx.globalAlpha=p.keyboard*.75;ctx.strokeStyle='#6cf5ff';ctx.fillStyle='rgba(48,222,245,.17)';ctx.lineWidth=2;
 ctx.beginPath();ctx.moveTo(275,521);ctx.lineTo(486,521);ctx.lineTo(520,562);ctx.lineTo(244,562);ctx.closePath();ctx.fill();ctx.stroke();
 for(let row=0;row<3;row++)for(let column=0;column<10;column++){
  const x=277+column*20-row*5,y=528+row*9;ctx.fillStyle=(column+row+Math.floor(phase*24))%9===0?'#a0fdff':'rgba(105,239,255,.3)';ctx.fillRect(x,y,13,5);
 }
 ctx.restore();
}
window.drawAvatar=(type,state,time,kind,size,transitionFrom=null)=>{
 if(!parts)throw new Error('Initialize first');
 canvas.width=size;canvas.height=size;ctx.clearRect(0,0,size,size);ctx.scale(size/768,size/768);
 const phase=(time%4)/4;
 let p=pose(state,phase);
 if(transitionFrom){const progress=Math.min(1,time/1.5),ease=progress*progress*(3-2*progress);p=mix(pose(transitionFrom,0),pose(state,0),ease);}
 if(kind==='portrait'){
  ctx.save();ctx.beginPath();ctx.arc(384,384,380,0,tau);ctx.clip();
  const h=type==='neutral'?540:650;head(384,type==='neutral'?370:385,h,p,phase);ctx.restore();
 }else{
  const bodyTop=type==='neutral'?355:300;
  ctx.save();ctx.translate(0,p.breathe);
  part(parts.body,384,bodyTop,config.bodyH,0,0);
  keyboard(p,phase);
  part(parts.left,384-config.shoulderX,config.shoulderY,config.armH,p.left,.08);
  part(parts.right,384+config.shoulderX,config.shoulderY,config.armH,p.right,.08);
  head(384,type==='neutral'?258:210,config.headH,p,phase);
  ctx.restore();
 }
 return canvas.toDataURL('image/png').split(',')[1];
};
