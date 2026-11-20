import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
test('web markup preserves unique IDs and every existing controller binding',async()=>{
 const base=process.env.HARNESS_TEST_WEB_ASSETS ? new URL('file://'+process.env.HARNESS_TEST_WEB_ASSETS+'/') : new URL('../src/interfaces/web/public/',import.meta.url);
 const html=await readFile(new URL('index.html',base),'utf8');
 const source=await readFile(new URL('app.js',base),'utf8');
 const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
 const unique=new Set(ids);assert.equal(unique.size,ids.length,'duplicate DOM ID');
 for(const match of source.matchAll(/\$\("([^"]+)"\)/g))assert(unique.has(match[1]),`missing controller element: ${match[1]}`);
 for(const id of ['setup-dialog','context-dialog','workspace-item-menu','screen-home','screen-conversations','screen-projects','screen-memories','screen-more'])assert(unique.has(id),`missing screen: ${id}`);
});
