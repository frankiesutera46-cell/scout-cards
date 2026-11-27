/* Juice Box Football — Playbook tab.
   A call finder each coach builds for their own team: pick a pressure type, then front -> coverage
   (or coverage -> front), then open the play card. Calls are stored per user in Supabase
   (table call_playbooks, one JSON document per coach) and card pictures in the private
   storage bucket playbook-cards under the coach's own folder. See supabase/playbook.sql.
   Talks to the main app only through window.JBF (set in app.js). */
(function(){
'use strict';

var TABLE='call_playbooks', BUCKET='playbook-cards';
var TYPE_ORDER=['Base','Sim','Blitz','Twist game'];
var COLS=[['name',['call','name','play','call name']],['front',['front']],['coverage',['coverage','cov']],
  ['type',['pressure','type','pressure type']],['who',['who','who is coming','blitzer','rusher','pressure detail']],
  ['snaps',['snaps','snap','count']],['tag',['tag','status','group']],['page',['slide','page','pdf page']],
  ['link',['link','url']],['notes',['notes','note']]];

var S={calls:[],loadedFor:undefined,mode:'fc',ty:null,a:null,b:null,q:'',urls:{},mem:{},busy:'',shareId:null,view:false};
var SHARE_TABLE='shares',shareTimer=null;
var root=null,saveTimer=null;

function jb(){return window.JBF||{}}
function sb(){return jb().sb||null}
function user(){return jb().user?jb().user():null}
function toast(m){try{if(jb().toast)jb().toast(m)}catch(e){}}
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function newId(){return 'c'+Date.now().toString(36)+Math.random().toString(36).slice(2,8)}
function lsKey(){var u=user();return (u?u.id+'_':'')+'jbCallPlaybook'}
function covs(c){var v=String(c.coverage||'').split(/\s+\/\s+/).map(function(x){return x.trim()}).filter(Boolean);return v.length?v:['No coverage']}
function frontOf(c){return c.front||'No front'}
function typeOf(c){return c.type||'Base'}

/* ---------- storage ---------- */
function nums(v){return String(v==null?'':v).split(/[^0-9]+/).map(function(x){return parseInt(x,10)}).filter(function(n){return n>0})}
function used(path,except){return S.calls.some(function(x){return x!==except&&x.imgs.indexOf(path)>=0})}
function allImgs(){var o=[];S.calls.forEach(function(c){c.imgs.forEach(function(p){if(o.indexOf(p)<0)o.push(p)})});return o}
// A call can have several sheets: pages = slide/PDF page numbers, imgs = one stored picture per sheet.
// page and img mirror the first of each (and are what older saved data has).
function normalize(list){
  return (Array.isArray(list)?list:[]).filter(function(c){return c&&c.name}).map(function(c){
    var pages=Array.isArray(c.pages)&&c.pages.length?nums(c.pages.join(',')):nums(c.page);
    var imgs=Array.isArray(c.imgs)&&c.imgs.length?c.imgs.filter(Boolean):(c.img?[c.img]:[]);
    return {id:c.id||newId(),name:String(c.name),front:c.front||'',coverage:c.coverage||'',type:c.type||'Base',who:c.who||'',
      snaps:parseInt(c.snaps,10)||0,tag:c.tag||'',page:pages[0]||0,pages:pages,img:imgs[0]||'',imgs:imgs,link:c.link||'',notes:c.notes||''};
  });
}
async function load(){
  var u=user(),key=u?u.id:null;
  if(S.loadedFor===key)return;
  S.loadedFor=key;S.calls=[];S.urls={};S.shareId=null;
  try{var r=localStorage.getItem(lsKey());if(r)S.calls=normalize(JSON.parse(r).calls)}catch(e){}
  if(u&&sb()){
    S.busy='Loading your playbook…';draw();
    try{
      var res=await sb().from(TABLE).select('data').eq('user_id',u.id).maybeSingle();
      if(res.error){S.setup=/does not exist|schema cache|404/i.test(res.error.message||'')||res.error.code==='42P01'||res.error.code==='PGRST205'}
      else if(res.data&&res.data.data){S.calls=normalize(res.data.data.calls);S.shareId=res.data.data.shareId||null}
    }catch(e){}
    S.busy='';
    await signUrls();
  }
  draw();
}
function save(){
  if(S.view)return;
  try{localStorage.setItem(lsKey(),JSON.stringify({calls:S.calls}))}catch(e){}
  var u=user();if(!u||!sb())return;
  if(S.shareId){clearTimeout(shareTimer);shareTimer=setTimeout(function(){publishShare().catch(function(){})},2500)}
  clearTimeout(saveTimer);
  saveTimer=setTimeout(async function(){
    try{
      var res=await sb().from(TABLE).upsert({user_id:u.id,data:{calls:S.calls,shareId:S.shareId||null},updated_at:new Date().toISOString()},{onConflict:'user_id'});
      if(res.error){console.warn('Playbook save failed:',res.error);toast('Playbook could not be saved to the cloud')}
    }catch(e){console.warn(e)}
  },600);
}
async function signUrls(){
  var u=user();if(!u||!sb())return;
  var paths=allImgs().filter(function(p){return !S.urls[p]&&p.indexOf('mem:')!==0});
  for(var i=0;i<paths.length;i+=100){
    try{
      var res=await sb().storage.from(BUCKET).createSignedUrls(paths.slice(i,i+100),60*60*6);
      (res.data||[]).forEach(function(d){if(d&&d.signedUrl)S.urls[d.path]=d.signedUrl});
    }catch(e){}
  }
}
function srcOf(p){return p?(S.urls[p]||S.mem[p]||''):''}
function imgSrc(c){return srcOf(c.img)}
function imgSrcs(c){return c.imgs.map(srcOf).filter(Boolean)}
async function putImage(blob,label){
  var u=user();
  if(!u||!sb()){ // demo: keep the picture for this session only
    var k='mem:'+newId();S.mem[k]=URL.createObjectURL(blob);return k;
  }
  var path=u.id+'/'+Date.now()+'-'+String(label).replace(/[^a-z0-9]+/gi,'-').slice(0,40)+'.jpg';
  var res=await sb().storage.from(BUCKET).upload(path,blob,{contentType:'image/jpeg',upsert:true});
  if(res.error)throw res.error;
  S.mem[path]=URL.createObjectURL(blob);
  return path;
}
async function removeImages(paths){
  var u=user();paths=paths.filter(function(p){return p&&p.indexOf('mem:')!==0});
  if(!u||!sb()||!paths.length)return;
  try{await sb().storage.from(BUCKET).remove(paths)}catch(e){}
}
function shrink(file,maxW){ // image file -> jpeg blob no wider than maxW
  return new Promise(function(ok,no){
    var im=new Image();
    im.onload=function(){
      var k=Math.min(1,maxW/im.width),cv=document.createElement('canvas');
      cv.width=Math.round(im.width*k);cv.height=Math.round(im.height*k);
      var x=cv.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,cv.width,cv.height);x.drawImage(im,0,0,cv.width,cv.height);
      cv.toBlob(function(b){b?ok(b):no(new Error('Could not read that picture'))},'image/jpeg',.8);
    };
    im.onerror=function(){no(new Error('Could not read that picture'))};
    im.src=URL.createObjectURL(file);
  });
}

/* ---------- view-only share link ---------- */
function shareUrl(){return location.origin+'/?playbook='+S.shareId}
async function publishShare(){ // writes a read-only snapshot anyone with the link can open
  var u=user();if(!u||!sb())throw new Error('Sign in to share your playbook.');
  var urls={},paths=allImgs().filter(function(p){return p.indexOf('mem:')!==0});
  for(var i=0;i<paths.length;i+=100){
    var r=await sb().storage.from(BUCKET).createSignedUrls(paths.slice(i,i+100),60*60*24*365);
    if(r.error)throw r.error;
    (r.data||[]).forEach(function(d){if(d&&d.signedUrl)urls[d.path]=d.signedUrl});
  }
  var payload={kind:'playbook',updated:new Date().toISOString(),calls:S.calls.map(function(c){
    return {name:c.name,front:c.front,coverage:c.coverage,type:c.type,who:c.who,snaps:c.snaps,tag:c.tag,notes:c.notes,link:c.link,u:urls[c.img]||'',us:c.imgs.map(function(p){return urls[p]}).filter(Boolean)};
  })};
  var res=null;
  if(S.shareId)res=await sb().from(SHARE_TABLE).update({game_name:'Playbook',data:payload}).eq('id',S.shareId).select('id').single();
  if(!S.shareId||res.error)res=await sb().from(SHARE_TABLE).insert({user_id:u.id,game_name:'Playbook',data:payload}).select('id').single();
  if(res.error)throw res.error;
  if(S.shareId!==res.data.id){S.shareId=res.data.id;save()}
  return S.shareId;
}
async function stopShare(){
  if(!S.shareId||!sb())return;
  clearTimeout(shareTimer);
  var res=await sb().from(SHARE_TABLE).update({game_name:'Playbook',data:{kind:'playbook',off:true}}).eq('id',S.shareId).select('id').single();
  if(res.error)throw res.error;
  S.shareId=null;save();
}
async function loadShared(id){
  S.view=true;S.busy='Loading playbook\u2026';draw();
  var bad='';
  try{
    var res=await sb().from(SHARE_TABLE).select('data').eq('id',id).single();
    var d=res.data&&res.data.data;
    if(res.error||!d||d.kind!=='playbook')bad='This playbook link was not found.';
    else if(d.off)bad='This playbook link has been turned off. Ask the coach who sent it for a new one.';
    else{
      S.calls=normalize(d.calls);
      (d.calls||[]).filter(function(c){return c&&c.name}).forEach(function(c,i){
        var us=Array.isArray(c.us)&&c.us.length?c.us:(c.u?[c.u]:[]),t=S.calls[i];if(!t||!us.length)return;
        t.imgs=us.map(function(u,j){var k='v:'+i+':'+j;S.mem[k]=u;return k});t.img=t.imgs[0];
      });
    }
  }catch(e){bad='This playbook could not be loaded. Check your connection and try again.'}
  S.busy='';S.viewError=bad;draw();
}
function openShare(){
  if(!user()){modal('<div class="pbk-dh"><h2>Share</h2><button class="pbk-btn" data-act="mclose">Close</button></div><div class="pbk-form"><p>Sign up to share your playbook with your staff.</p></div>');return}
  var on=!!S.shareId;
  modal('<div class="pbk-dh"><h2>Share with your staff</h2><button class="pbk-btn" data-act="mclose">Close</button></div><div class="pbk-form">'+
    (on?'<p>Anyone with this link can look through your playbook. They cannot change it, and they do not need an account. It updates on its own when you edit calls.</p>'+
        '<label class="pbk-f"><span>View-only link</span><input id="pbkShareUrl" readonly value="'+esc(shareUrl())+'"/></label>'+
        '<div class="pbk-form-btns"><button class="pbk-btn pbk-danger" data-act="shareoff">Turn off link</button><button class="pbk-btn pbk-primary" data-act="sharecopy">Copy link</button></div>'
       :'<p>Create a view-only link to your playbook. Anyone with the link can look through your calls and play cards. They cannot change anything, and they do not need an account.</p>'+
        '<p>Treat the link like the playbook itself: anyone it gets forwarded to can open it. You can turn it off here at any time.</p>'+
        '<div class="pbk-form-btns"><span></span><button class="pbk-btn pbk-primary" data-act="shareon">Create view-only link</button></div>')+
    '<div class="pbk-msg" id="pbkShareMsg"></div></div>');
  var i=root.querySelector('#pbkShareUrl');if(i)i.addEventListener('focus',function(){i.select()});
}
function shareMsg(t){var m=root.querySelector('#pbkShareMsg');if(m)m.textContent=t}
async function shareOn(btn){
  btn.disabled=true;shareMsg('Creating your link\u2026');
  try{await publishShare();openShare();shareMsg('Link created. Copy it and send it to your staff.')}
  catch(e){btn.disabled=false;shareMsg('The link could not be created: '+(e.message||e))}
}
async function shareOff(btn){
  if(btn.getAttribute('data-sure')!=='1'){btn.setAttribute('data-sure','1');btn.textContent='Tap again to turn off';return}
  btn.disabled=true;
  try{await stopShare();openShare();shareMsg('Link turned off. The old link no longer opens your playbook.')}
  catch(e){btn.disabled=false;shareMsg('The link could not be turned off: '+(e.message||e))}
}
function shareCopy(){
  var url=shareUrl(),i=root.querySelector('#pbkShareUrl');
  try{navigator.clipboard.writeText(url).then(function(){shareMsg('Link copied.')},function(){if(i){i.focus();i.select()}shareMsg('Press and hold the link to copy it.')})}
  catch(e){if(i){i.focus();i.select()}shareMsg('Press and hold the link to copy it.')}
}

/* ---------- CSV ---------- */
function parseCSV(text){
  var rows=[],row=[],cur='',q=false;text=text.replace(/^﻿/,'');
  for(var i=0;i<text.length;i++){
    var ch=text[i];
    if(q){if(ch==='"'){if(text[i+1]==='"'){cur+='"';i++}else q=false}else cur+=ch}
    else if(ch==='"')q=true;
    else if(ch===','){row.push(cur);cur=''}
    else if(ch==='\n'||ch==='\r'){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cur);cur='';rows.push(row);row=[]}
    else cur+=ch;
  }
  if(cur!==''||row.length){row.push(cur);rows.push(row)}
  return rows.filter(function(r){return r.some(function(c){return String(c).trim()!==''})});
}
function callsFromCSV(text){
  var rows=parseCSV(text);if(rows.length<2)throw new Error('That file has no calls in it.');
  var head=rows[0].map(function(h){return String(h).trim().toLowerCase()}),map={};
  COLS.forEach(function(c){for(var i=0;i<head.length;i++){if(c[1].indexOf(head[i])>=0){map[c[0]]=i;break}}});
  if(map.name==null)throw new Error('The file needs a column named "Call".');
  return normalize(rows.slice(1).map(function(r){
    var o={};Object.keys(map).forEach(function(k){o[k]=String(r[map[k]]==null?'':r[map[k]]).trim()});
    if(/^=?hyperlink/i.test(o.link||''))o.link='';
    return o;
  }));
}
function csvCell(v){v=String(v==null?'':v);return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v}
function toCSV(list){
  var out=[['Call','Front','Coverage','Pressure','Who','Snaps','Tag','Slide','Link','Notes']];
  list.forEach(function(c){out.push([c.name,c.front,c.coverage,c.type,c.who,c.snaps||'',c.tag,c.pages&&c.pages.length?c.pages.join(', '):(c.page||''),c.link,c.notes])});
  return out.map(function(r){return r.map(csvCell).join(',')}).join('\n');
}
function download(name,text){
  var a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type:'text/csv'}));a.download=name;
  document.body.appendChild(a);a.click();setTimeout(function(){a.remove()},100);
}
var TEMPLATE=[{name:'Base 4',front:'Base',coverage:'C4',type:'Base',who:'',snaps:0,tag:'',page:'2, 3',link:'',notes:'More than one sheet: list every slide number'},
  {name:'Load Favre 3',front:'Load',coverage:'C3',type:'Sim',who:'Nickel',snaps:0,tag:'',page:14,link:'',notes:''},
  {name:'Ace Brady Check',front:'Ace',coverage:'C3 / QQH',type:'Sim',who:'LB',snaps:0,tag:'',page:0,link:'',notes:'Two coverages: separate them with " / "'}];

/* ---------- PDF pictures ---------- */
async function picturesFromPDF(file,onStep){
  if(!window.pdfjsLib)throw new Error('The PDF reader did not load. Check your connection and try again.');
  try{if(!window.pdfjsLib.GlobalWorkerOptions.workerSrc)window.pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'}catch(e){}
  var pdf=await window.pdfjsLib.getDocument({data:await file.arrayBuffer()}).promise;
  var pages=[];S.calls.forEach(function(c){c.pages.forEach(function(n){if(n<=pdf.numPages&&pages.indexOf(n)<0)pages.push(n)})});
  pages.sort(function(a,b){return a-b});
  if(!pages.length)throw new Error('No call has a Slide number that matches a page in this PDF.');
  var old=[],done=0,byPage={};
  for(var i=0;i<pages.length;i++){
    var n=pages[i];onStep('Page '+n+' ('+(i+1)+' of '+pages.length+')');
    var pg=await pdf.getPage(n),vp=pg.getViewport({scale:1});vp=pg.getViewport({scale:Math.min(2,1100/vp.width)});
    var cv=document.createElement('canvas');cv.width=Math.round(vp.width);cv.height=Math.round(vp.height);
    var cx=cv.getContext('2d');cx.fillStyle='#fff';cx.fillRect(0,0,cv.width,cv.height);
    await pg.render({canvasContext:cx,viewport:vp}).promise;
    var blob=await new Promise(function(ok){cv.toBlob(ok,'image/jpeg',.76)});
    var path=await putImage(blob,'p'+n);
    byPage[n]=path;
  }
  S.calls.forEach(function(c){
    var next=c.pages.map(function(n){return byPage[n]}).filter(Boolean);if(!next.length)return;
    c.imgs.forEach(function(p){if(old.indexOf(p)<0)old.push(p)});c.imgs=next;c.img=next[0];done++;
  });
  removeImages(old.filter(function(p){return !used(p,null)}));
  save();
  return {pages:pages.length,calls:done};
}

/* ---------- view ---------- */
function pool0(){var q=S.q;return S.calls.filter(function(c){return !q||c.name.toLowerCase().indexOf(q)>=0})}
function k1(c){return S.mode==='fc'?[frontOf(c)]:covs(c)}
function k2(c){return S.mode==='fc'?covs(c):[frontOf(c)]}
function tally(items,key,fixed){
  var n={};items.forEach(function(c){[].concat(key(c)).forEach(function(k){n[k]=(n[k]||0)+1})});
  var keys=Object.keys(n).sort(function(x,y){
    var ix=fixed?fixed.indexOf(x):-1,iy=fixed?fixed.indexOf(y):-1;
    if(ix>=0||iy>=0)return (ix<0?99:ix)-(iy<0?99:iy);
    return n[y]-n[x]||x.localeCompare(y);
  });
  return keys.map(function(k){return [k,n[k]]});
}
function chipRow(act,list,sel,total){
  var h='<button class="pbk-chip'+(sel===null?' on':'')+'" data-act="'+act+'" data-v="">All <span>'+total+'</span></button>';
  list.forEach(function(e){h+='<button class="pbk-chip'+(sel===e[0]?' on':'')+'" data-act="'+act+'" data-v="'+esc(e[0])+'">'+esc(e[0])+' <span>'+e[1]+'</span></button>'});
  return h;
}
function typeClass(t){t=String(t).toLowerCase();return t==='base'?'base':t==='sim'?'sim':t==='blitz'?'blitz':/twist/.test(t)?'twist':'other'}
function has(arr,v){return arr.indexOf(v)>=0}

function shell(){
  root.innerHTML=
  '<div class="pbk-top">'+
    '<div class="pbk-brand"><img src="juice-wordmark.png" alt="Juice Box"/><span>Playbook'+(S.view?' \u00b7 view only':'')+'</span></div>'+
    '<div class="pbk-top-right">'+
      '<input class="pbk-search" id="pbkQ" type="search" placeholder="Search calls" aria-label="Search calls"/>'+
      (S.view?'':'<button class="pbk-btn" data-act="add">Add call</button>'+
      '<button class="pbk-btn" data-act="import">Import</button>'+
      '<button class="pbk-btn" data-act="share">Share</button>'+
      '<button class="pbk-btn pbk-primary" data-act="close">Back to cards</button>')+
    '</div>'+
  '</div>'+
  '<div class="pbk-main" id="pbkMain"></div><div id="pbkModal"></div>';
  root.querySelector('#pbkQ').addEventListener('input',function(e){S.q=e.target.value.trim().toLowerCase();draw()});
}
function draw(){
  if(!root)return;var main=root.querySelector('#pbkMain');if(!main)return;
  if(S.busy){main.innerHTML='<div class="pbk-empty"><p>'+esc(S.busy)+'</p></div>';return}
  var h='';
  if(S.view){
    if(S.viewError){main.innerHTML='<div class="pbk-empty"><h2>Playbook not available</h2><p>'+esc(S.viewError)+'</p></div>';return}
    if(!S.calls.length){main.innerHTML='<div class="pbk-empty"><h2>No calls yet</h2><p>This playbook is empty.</p></div>';return}
  }
  else if(S.setup)h+='<div class="pbk-note">Playbook storage is not set up on this site yet, so changes stay on this device. Run supabase/playbook.sql once in Supabase to turn on cloud saving.</div>';
  else if(!user())h+='<div class="pbk-note">You are in demo mode. Sign up to save your playbook and its pictures.</div>';
  if(!S.calls.length){
    main.innerHTML=h+'<div class="pbk-empty"><h2>Build your playbook</h2>'+
      '<p>Add every call once. Then find any of them in three clicks: pressure, front, coverage.</p>'+
      '<div class="pbk-empty-btns"><button class="pbk-btn pbk-primary" data-act="import">Import a call list</button>'+
      '<button class="pbk-btn" data-act="add">Add a call by hand</button></div></div>';
    return;
  }
  var z=pool0();
  if(S.ty!==null&&!z.some(function(c){return typeOf(c)===S.ty}))S.ty=null;
  var p=z.filter(function(c){return S.ty===null||typeOf(c)===S.ty});
  if(S.a!==null&&!p.some(function(c){return has(k1(c),S.a)})){S.a=null;S.b=null}
  var p1=S.a===null?p:p.filter(function(c){return has(k1(c),S.a)});
  if(S.b!==null&&!p1.some(function(c){return has(k2(c),S.b)}))S.b=null;
  var p2=S.b===null?p1:p1.filter(function(c){return has(k2(c),S.b)});
  var w1=S.mode==='fc'?'front':'coverage',w2=S.mode==='fc'?'coverage':'front';
  h+='<div class="pbk-bar"><div class="pbk-seg" role="group" aria-label="Sort order">'+
     '<button class="'+(S.mode==='fc'?'on':'')+'" data-act="mode" data-v="fc">Front, then coverage</button>'+
     '<button class="'+(S.mode==='cf'?'on':'')+'" data-act="mode" data-v="cf">Coverage, then front</button></div>'+
     '<span class="pbk-count">'+S.calls.length+' calls</span></div>';
  h+='<section class="pbk-step"><h3>Pressure</h3><div class="pbk-chips">'+chipRow('ty',tally(z,typeOf,TYPE_ORDER),S.ty,z.length)+'</div></section>';
  h+='<section class="pbk-step"><h3>1 · Pick a '+w1+'</h3><div class="pbk-chips">'+chipRow('a',tally(p,k1),S.a,p.length)+'</div></section>';
  h+='<section class="pbk-step"><h3>2 · Pick a '+w2+(S.a?' in <b>'+esc(S.a)+'</b>':'')+'</h3><div class="pbk-chips">'+chipRow('b',tally(p1,k2),S.b,p1.length)+'</div></section>';
  h+='<section class="pbk-step"><h3>3 · Play cards ('+p2.length+')</h3><div class="pbk-cards">';
  if(!p2.length)h+='<div class="pbk-none">No calls match. Clear the search to see them all.</div>';
  p2.slice().sort(function(x,y){return y.snaps-x.snaps||x.name.localeCompare(y.name)}).forEach(function(c){
    var src=imgSrc(c);
    h+='<button class="pbk-card" data-act="open" data-v="'+esc(c.id)+'">'+
      (src?'<img loading="lazy" alt="" src="'+esc(src)+'"/>':'<div class="pbk-noimg">'+(S.view?'No picture':'No picture yet')+'</div>')+
      '<div class="pbk-card-b"><div class="pbk-card-n">'+esc(c.name)+'</div>'+
      '<div class="pbk-meta"><b>'+esc(frontOf(c))+'</b><span>'+esc(covs(c).join(' / '))+'</span>'+(c.snaps?'<span>'+c.snaps+(c.snaps===1?' snap':' snaps')+'</span>':'')+(c.imgs.length>1?'<span>'+c.imgs.length+' sheets</span>':'')+'</div>'+
      (c.who?'<div class="pbk-meta"><span>'+esc(c.who)+'</span></div>':'')+
      '<div class="pbk-pills"><span class="pbk-ty pbk-ty-'+typeClass(typeOf(c))+'">'+esc(typeOf(c))+'</span>'+(c.tag?'<span class="pbk-tag">'+esc(c.tag)+'</span>':'')+'</div>'+
      '</div></button>';
  });
  h+='</div></section>';
  main.innerHTML=h;
}

/* ---------- modals ---------- */
function modal(html){var m=root.querySelector('#pbkModal');m.innerHTML=html?'<div class="pbk-ov" data-act="ov"><div class="pbk-dlg" role="dialog" aria-modal="true">'+html+'</div></div>':'';}
function closeModal(){modal('')}
function find(id){for(var i=0;i<S.calls.length;i++)if(S.calls[i].id===id)return S.calls[i];return null}

function openCard(id){
  var c=find(id);if(!c)return;var src=imgSrc(c);
  var rows=[['Front',frontOf(c)],['Coverage',covs(c).join(' / ')],['Pressure',typeOf(c)],['Who is coming',c.who||'—'],['Snaps',c.snaps||0]];
  if(c.tag)rows.push(['Tag',c.tag]);
  modal('<div class="pbk-dh"><h2>'+esc(c.name)+'</h2><div>'+(S.view?'':'<button class="pbk-btn" data-act="edit" data-v="'+esc(c.id)+'">Edit</button> ')+'<button class="pbk-btn" data-act="mclose">Close</button></div></div>'+
    (src?imgSrcs(c).map(function(u,i,a){return (a.length>1?'<div class="pbk-sheet">Sheet '+(i+1)+' of '+a.length+'</div>':'')+'<img class="pbk-big" alt="'+esc(c.name)+' sheet '+(i+1)+'" src="'+esc(u)+'"/>'}).join(''):'<div class="pbk-noimg pbk-big">'+(S.view?'No picture for this call.':'No picture yet. Edit this call to add one.')+'</div>')+
    '<div class="pbk-db"><dl>'+rows.map(function(r){return '<div><dt>'+r[0]+'</dt><dd>'+esc(r[1])+'</dd></div>'}).join('')+'</dl>'+
    (c.notes?'<p class="pbk-notes">'+esc(c.notes)+'</p>':'')+
    (/^https?:\/\//i.test(c.link)?'<a href="'+esc(c.link)+'" target="_blank" rel="noopener">Open the slide</a>':'')+'</div>');
}
function opts(id,vals){return '<datalist id="'+id+'">'+vals.map(function(v){return '<option value="'+esc(v)+'">'}).join('')+'</datalist>'}
function uniq(fn){var o={};S.calls.forEach(function(c){[].concat(fn(c)).forEach(function(v){if(v)o[v]=1})});return Object.keys(o).sort()}
function field(label,id,val,extra){return '<label class="pbk-f"><span>'+label+'</span><input id="'+id+'" value="'+esc(val)+'" '+(extra||'')+'/></label>'}
function openForm(id){
  var c=id?find(id):null,v=c||{name:'',front:S.mode==='fc'&&S.a?S.a:'',coverage:'',type:S.ty||'Base',who:'',snaps:'',tag:'',page:'',link:'',notes:''};
  modal('<div class="pbk-dh"><h2>'+(c?'Edit call':'Add a call')+'</h2><button class="pbk-btn" data-act="mclose">Cancel</button></div>'+
    '<form class="pbk-form" id="pbkForm" data-id="'+esc(c?c.id:'')+'">'+
    field('Call name','pfName',v.name,'required placeholder="Load Favre 3"')+
    '<div class="pbk-f2">'+field('Front','pfFront',v.front,'list="pdlF" placeholder="Base, Load, Ace…"')+
      field('Coverage','pfCov',v.coverage,'list="pdlC" placeholder="C3 (two? C3 / QQH)"')+'</div>'+
    '<div class="pbk-f2">'+field('Pressure','pfType',v.type,'list="pdlT" placeholder="Base, Sim, Blitz, Twist game"')+
      field('Who is coming','pfWho',v.who,'list="pdlW" placeholder="LB, Nickel, Corner…"')+'</div>'+
    '<div class="pbk-f2">'+field('Snaps called','pfSnaps',v.snaps||'','type="number" min="0" inputmode="numeric"')+
      field('Tag (optional)','pfTag',v.tag,'list="pdlG" placeholder="3rd down, Red zone…"')+'</div>'+
    '<div class="pbk-f2">'+field('Slides or PDF pages (optional)','pfPage',(v.pages&&v.pages.length?v.pages.join(', '):''),'placeholder="2, 3, 9"')+
      field('Link (optional)','pfLink',v.link,'type="url" placeholder="https://"')+'</div>'+
    '<label class="pbk-f"><span>Notes (optional)</span><textarea id="pfNotes" rows="2">'+esc(v.notes)+'</textarea></label>'+
    '<label class="pbk-f"><span>Pictures of the play'+(c&&c.img?' (leave empty to keep the current '+c.imgs.length+'; choosing new ones replaces them)':' (pick more than one for several sheets)')+'</span><input id="pfImg" type="file" accept="image/*" multiple/></label>'+
    opts('pdlF',uniq(function(x){return x.front}))+opts('pdlC',uniq(function(x){return covs(x).filter(function(k){return k!=='No coverage'})}))+
    opts('pdlT',TYPE_ORDER.concat(uniq(typeOf).filter(function(t){return TYPE_ORDER.indexOf(t)<0})))+opts('pdlW',uniq(function(x){return x.who}))+opts('pdlG',uniq(function(x){return x.tag}))+
    '<div class="pbk-form-btns">'+(c?'<button type="button" class="pbk-btn pbk-danger" data-act="del" data-v="'+esc(c.id)+'">Delete call</button>':'<span></span>')+
    '<button type="submit" class="pbk-btn pbk-primary" id="pfSave">Save call</button></div><div class="pbk-msg" id="pfMsg"></div></form>');
  var f=root.querySelector('#pbkForm');
  f.addEventListener('submit',function(e){e.preventDefault();saveForm(f)});
  var n=root.querySelector('#pfName');if(n&&!c)n.focus();
}
function val(id){var e=root.querySelector('#'+id);return e?String(e.value).trim():''}
async function saveForm(f){
  var id=f.getAttribute('data-id'),c=id?find(id):null,msg=root.querySelector('#pfMsg'),btn=root.querySelector('#pfSave');
  var name=val('pfName');if(!name){msg.textContent='Give the call a name.';return}
  btn.disabled=true;msg.textContent='Saving…';
  var o=c||{id:newId(),img:'',imgs:[]};
  o.name=name;o.front=val('pfFront');o.coverage=val('pfCov');o.type=val('pfType')||'Base';o.who=val('pfWho');
  o.snaps=parseInt(val('pfSnaps'),10)||0;o.tag=val('pfTag');o.pages=nums(val('pfPage'));o.page=o.pages[0]||0;o.link=val('pfLink');o.notes=val('pfNotes');
  var files=[].slice.call(root.querySelector('#pfImg').files||[]);
  try{
    if(files.length){
      var old=o.imgs.slice(),next=[];
      for(var i=0;i<files.length;i++)next.push(await putImage(await shrink(files[i],1400),name+'-'+(i+1)));
      o.imgs=next;o.img=next[0];
      removeImages(old.filter(function(p){return !used(p,o)}));
    }
  }catch(e){btn.disabled=false;msg.textContent='The picture did not upload: '+(e.message||e)+'. The rest was not saved.';return}
  if(!c)S.calls.push(o);
  save();closeModal();draw();toast(c?'Call updated':'Call added');
}
function delCall(id,btn){
  if(btn.getAttribute('data-sure')!=='1'){btn.setAttribute('data-sure','1');btn.textContent='Tap again to delete';return}
  var c=find(id);if(!c)return;
  S.calls=S.calls.filter(function(x){return x.id!==id});
  removeImages(c.imgs.filter(function(p){return !used(p,null)}));
  save();closeModal();draw();toast('Call deleted');
}
function openImport(){
  var n=S.calls.length,withPage=S.calls.filter(function(c){return c.pages.length>0}).length;
  modal('<div class="pbk-dh"><h2>Import</h2><button class="pbk-btn" data-act="mclose">Close</button></div><div class="pbk-form">'+
    '<h3>1 · Call list</h3><p>Upload a CSV with one call per row. Columns: Call, Front, Coverage, Pressure, Who, Snaps, Tag, Slide, Link, Notes. Only Call is required. In Excel or Google Sheets, use File, Download, CSV.</p>'+
    '<div class="pbk-row"><button class="pbk-btn" data-act="tpl">Download a blank template</button>'+(n?'<button class="pbk-btn" data-act="export">Download my calls</button>':'')+'</div>'+
    (n?'<div class="pbk-radio"><label><input type="radio" name="pbkHow" id="pbkHowAdd" value="add" checked/> Add to my '+n+' calls (same name and front gets updated)</label>'+
       '<label><input type="radio" name="pbkHow" id="pbkHowRep" value="replace"/> Replace all '+n+' calls</label></div>':'')+
    '<label class="pbk-f"><span>Call list file (.csv)</span><input id="pbkCsv" type="file" accept=".csv,text/csv"/></label>'+
    '<h3>2 · Pictures from your playbook PDF</h3><p>Upload the playbook as a PDF. Each call that has a Slide number gets that page as its picture. A call with several numbers (2, 3, 9) gets every one of those sheets.'+(n?' '+withPage+' of your '+n+' calls have a Slide number.':'')+'</p>'+
    '<label class="pbk-f"><span>Playbook file (.pdf)</span><input id="pbkPdf" type="file" accept="application/pdf,.pdf"/></label>'+
    '<div class="pbk-msg" id="pbkImpMsg"></div></div>');
  root.querySelector('#pbkCsv').addEventListener('change',function(e){var f=e.target.files[0];if(f)importCSV(f)});
  root.querySelector('#pbkPdf').addEventListener('change',function(e){var f=e.target.files[0];if(f)importPDF(f)});
}
function impMsg(t){var m=root.querySelector('#pbkImpMsg');if(m)m.textContent=t}
async function importCSV(file){
  try{
    var list=callsFromCSV(await file.text()),rep=root.querySelector('#pbkHowRep'),added=0,updated=0;
    if(rep&&rep.checked){
      var gone=allImgs();
      S.calls=list;added=list.length;removeImages(gone);
    }else{
      list.forEach(function(c){
        var hit=null;S.calls.forEach(function(x){if(x.name.toLowerCase()===c.name.toLowerCase()&&x.front.toLowerCase()===c.front.toLowerCase())hit=x});
        if(hit){var img=hit.img,imgs=hit.imgs,id=hit.id;Object.keys(c).forEach(function(k){hit[k]=c[k]});hit.id=id;hit.img=img;hit.imgs=imgs;updated++}else{S.calls.push(c);added++}
      });
    }
    S.ty=S.a=S.b=null;save();draw();openImport();
    impMsg('Call list imported: '+added+' added'+(updated?', '+updated+' updated':'')+'. Now add the playbook PDF below for pictures, or close this.');
  }catch(e){impMsg(e.message||String(e))}
}
async function importPDF(file){
  if(!S.calls.length){impMsg('Import your call list first, so each page has a call to go with.');return}
  try{
    var r=await picturesFromPDF(file,function(t){impMsg('Adding pictures… '+t)});
    draw();impMsg('Done. '+r.pages+' pages became pictures for '+r.calls+' calls.');toast('Pictures added');
  }catch(e){impMsg('The PDF import stopped: '+(e.message||e))}
}

/* ---------- wiring ---------- */
function onClick(e){
  var t=e.target.closest('[data-act]');if(!t||!root.contains(t))return;
  var act=t.getAttribute('data-act'),v=t.getAttribute('data-v');
  if(act==='ov'){if(e.target===t)closeModal();return}
  if(act==='close')return api.close();
  if(act==='mclose')return closeModal();
  if(act==='mode'){S.mode=v;S.a=S.b=null;return draw()}
  if(act==='ty'){S.ty=v||null;return draw()}
  if(act==='a'){S.a=v||null;S.b=null;return draw()}
  if(act==='b'){S.b=v||null;return draw()}
  if(act==='open')return openCard(v);
  if(S.view)return;
  if(act==='share')return openShare();
  if(act==='shareon')return shareOn(t);
  if(act==='shareoff')return shareOff(t);
  if(act==='sharecopy')return shareCopy();
  if(act==='edit')return openForm(v);
  if(act==='add')return openForm(null);
  if(act==='del')return delCall(v,t);
  if(act==='import')return openImport();
  if(act==='tpl')return download('juice-box-playbook-template.csv',toCSV(TEMPLATE));
  if(act==='export')return download('my-playbook-calls.csv',toCSV(S.calls));
}
var api={
  open:function(){
    if(!root){root=document.createElement('div');root.className='pbk';root.addEventListener('click',onClick);document.body.appendChild(root);
      document.addEventListener('keydown',function(e){if(e.key==='Escape'&&root.classList.contains('open')){var m=root.querySelector('.pbk-ov');if(m)closeModal()}})}
    shell();root.classList.add('open');draw();if(!S.view)load();
  },
  close:function(){if(root&&!S.view)root.classList.remove('open')},
  isOpen:function(){return !!(root&&root.classList.contains('open'))}
};
window.JBPlaybook=api;

// A view-only link (?playbook=<id>) opens straight into the shared playbook, no account needed.
var sharedId=null;try{sharedId=new URLSearchParams(location.search).get('playbook')}catch(e){}
if(sharedId&&sb()){
  S.view=true;
  ['auth-screen','landing-page'].forEach(function(id){var el=document.getElementById(id);if(el)el.classList.add('hidden')});
  api.open();loadShared(sharedId);
}
})();
