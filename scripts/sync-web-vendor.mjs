import {copyFile,mkdir,readFile,cp} from 'node:fs/promises';
const root=new URL('../',import.meta.url),out=new URL('src/interfaces/web/public/vendor/',root);
await mkdir(out,{recursive:true});
for(const [name,version,files] of [
 ['marked','18.2.0',{'lib/marked.umd.js':'marked.js','LICENSE':'marked-LICENSE.txt'}],
 ['katex','0.19.1',{'dist/katex.min.js':'katex/katex.min.js','dist/katex.min.css':'katex/katex.min.css','LICENSE':'katex/LICENSE.txt'}],
 ['dompurify','3.4.17',{'dist/purify.js':'purify.js','LICENSE':'dompurify-LICENSE.txt','LICENSE-MPL':'dompurify-LICENSE-MPL.txt'}]
]){
 const source=new URL('node_modules/'+name+'/',root);
 if(JSON.parse(await readFile(new URL('package.json',source),'utf8')).version!==version)throw new Error('Vendor version differs: '+name);
 if(name==='katex'){await mkdir(new URL('katex/',out),{recursive:true});await cp(new URL('dist/fonts/',source),new URL('katex/fonts/',out),{recursive:true});}
 for(const [file,destination] of Object.entries(files))await copyFile(new URL(file,source),new URL(destination,out));
}
console.log('Browser Markdown assets synchronized with pinned packages and license notices.');
