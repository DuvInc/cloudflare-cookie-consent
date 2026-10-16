/**
 * The script that ships to the browser, about 5.9 KB once the comments below
 * are stripped (see `RUNTIME`), 2.1 KB gzipped.
 * Three jobs and nothing else: take the click, tell the server, and bring the
 * blocked scripts back to life without a reload.
 *
 * Note what it does NOT do: it never renders the banner (the server did), it
 * never decides anything (the server did), and it never writes the cookie (the
 * server does, on the POST response, so the cookie can be HttpOnly and no
 * third-party script can read or forge it).
 *
 * This is a string inside a template literal, which has two consequences:
 * there is no backslash in it (a backslash in a template literal is swallowed,
 * so a regex escape here once shipped as the bare letter and silently matched
 * nothing: parse by splitting instead), and no backtick or dollar-brace.
 * test/runtime.test.mjs refuses all three.
 *
 * The comments are for you: `RUNTIME`, below, is this source without them.
 */
export const RUNTIME_SOURCE = `(function(){
var S=window.__consentState;if(!S)return;
var root=document.getElementById('cc-banner');

function unblock(granted){
  /* Carriers that are not scripts: the parked URL goes back. */
  var parked=document.querySelectorAll('[data-consent-src],[data-consent-href]');
  for(var p=0;p<parked.length;p++){
    var el=parked[p];
    if(granted.indexOf(el.getAttribute('data-consent'))<0)continue;
    if(el.hasAttribute('data-consent-src')){
      el.setAttribute('src',el.getAttribute('data-consent-src'));
      el.removeAttribute('data-consent-src');
    }else{
      el.setAttribute('href',el.getAttribute('data-consent-href'));
      el.removeAttribute('data-consent-href');
    }
  }

  /* A script cannot be switched back on by changing its type: the browser has
   * already decided it was not JavaScript. It is replaced by a copy. */
  var list=document.querySelectorAll('script[type="text/plain"][data-consent]');
  for(var i=0;i<list.length;i++){
    var old=list[i];
    if(granted.indexOf(old.getAttribute('data-consent'))<0)continue;
    var s=document.createElement('script');
    for(var j=0;j<old.attributes.length;j++){
      var a=old.attributes[j];
      if(a.name!=='type'&&a.name!=='data-consent-type')s.setAttribute(a.name,a.value);
    }
    /* The type it had before the edge parked it, for example "module". */
    var original=old.getAttribute('data-consent-type');
    if(original)s.setAttribute('type',original);
    s.textContent=old.textContent;
    old.parentNode.replaceChild(s,old);
  }
}

/* Google Consent Mode v2. Only when a dataLayer exists, which the server
 * creates only when googleConsentMode is on. */
function gtagUpdate(granted){
  if(!window.dataLayer)return;
  var on=function(c){return granted.indexOf(c)>=0?'granted':'denied'};
  window.dataLayer.push(['consent','update',{
    ad_storage:on('marketing'),ad_user_data:on('marketing'),ad_personalization:on('marketing'),
    analytics_storage:on('analytics'),personalization_storage:on('analytics')
  }]);
}

/* The half everyone forgets: withdrawing consent has to remove what was
 * already set, not merely stop setting more. A tool that leaves the cookies in
 * place has not honoured the withdrawal. */
function sweep(granted){
  var map=S.cookies||{},removed=[];
  for(var cat in map){
    if(granted.indexOf(cat)>=0)continue;
    for(var i=0;i<map[cat].length;i++){
      var n=map[cat][i];
      /* PostHog's persistence is the cookie AND localStorage (the name, plus
       * suffixed keys such as __flags): a cookie-only sweep would leave the
       * identifier on the device. So localStorage goes by prefix. */
      try{
        for(var k=localStorage.length-1;k>=0;k--){
          var key=localStorage.key(k);
          if(key&&key.indexOf(n)===0){localStorage.removeItem(key);removed.push(key)}
        }
      }catch(e){}
      if(document.cookie.indexOf(n+'=')<0)continue;
      /* A cookie can only be deleted by the domain that set it. PostHog sets
       * its own on the parent domain, not on the exact host: trying only
       * location.hostname leaves it in place. So every suffix is tried, down to
       * two labels. */
      document.cookie=n+'=; Path=/; Max-Age=0';
      var parts=location.hostname.split('.');
      for(var d=0;d<=parts.length-2;d++){
        var dom=parts.slice(d).join('.');
        document.cookie=n+'=; Path=/; Max-Age=0; Domain='+dom;
        document.cookie=n+'=; Path=/; Max-Age=0; Domain=.'+dom;
      }
      removed.push(n);
    }
  }
  return removed;
}

function apply(granted){
  /* What the visitor REMOVES, compared with what they had granted. */
  var lost=[];
  for(var li=0;li<S.granted.length;li++){
    if(S.granted[li]!=='essential'&&granted.indexOf(S.granted[li])<0)lost.push(S.granted[li]);
  }

  S.granted=granted;
  S.swept=sweep(granted);
  if(root)root.hidden=true;
  gtagUpdate(granted);
  unblock(granted);
  /* A tag can be revived in place; a bundled dependency cannot, because its
   * own branch already ran at load time. So the only way a bundle can honour
   * a choice without a reload is to be told. Measured: without this event the
   * app tracker stayed dead until the next navigation. */
  document.dispatchEvent(new CustomEvent('cookie-consent',{detail:{granted:granted.slice()}}));
  syncPanel();

  /* A withdrawal needs a reload, and that is not a nicety. Measured on a
   * preview: the sweep does delete PostHog's cookie, but the SDK is still
   * running in the page and sets it again within the second. Deleting without
   * stopping removes nothing. The next document comes from the server with
   * everything neutralised, so nothing can set it again.
   *
   * Only on a withdrawal: granting happens in place. */
  if(lost.length)location.reload();
}

function save(granted){
  fetch('/api/consent',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({granted:granted,locale:S.locale})
  }).then(function(r){return r.json()}).then(function(d){
    /* The decision the server just recorded, with its reference. Without this
     * S.consent stayed null after a choice made from the preferences page, and
     * the status line kept announcing that no choice was recorded. */
    if(d.id)S.consent={id:d.id,at:d.at};
    apply(d.granted||granted);
  }).catch(function(){apply(granted)});
}

function chosen(scope){
  var out=['essential'],b=scope.querySelectorAll('.cats input');
  for(var i=0;i<b.length;i++)if(b[i].checked&&b[i].value!=='essential')out.push(b[i].value);
  return out;
}

function onClick(e){
  var scope=e.currentTarget;
  var act=e.target.getAttribute&&e.target.getAttribute('data-act');
  if(!act)return;
  if(act==='accept')return save(S.categories.slice());
  if(act==='reject')return save(['essential']);
  if(act==='save')return save(chosen(scope));
  if(act==='detail'){
    scope.className='cc detail';
    scope.querySelector('[data-act="save"]').style.display='';
  }
}
if(root){root.addEventListener('click',onClick);focusBanner();}

function bind(el){
  root=el;
  root.hidden=false;
  root.addEventListener('click',onClick);
  focusBanner();
}

/* Measured: appended at the end of <body>, the banner was the 6th tab stop on
 * a page with four links, and on a real page it would be the fiftieth. A
 * keyboard user would have to traverse the whole document to reach "decline",
 * which is a dark pattern nobody designed on purpose. Moving focus to the
 * dialog puts the choice one Tab away, whatever the page contains. */
function focusBanner(){
  if(!root||root.hidden)return;
  var box=root.querySelector('.box');
  if(box&&box.focus)box.focus();
}

function onKey(e){
  if(e.key!=='Escape'||!root||root.hidden)return;
  /* Escape only dismisses when a choice already exists. On a first visit there
   * is nothing to fall back to, and closing silently would record no decision
   * while looking like one. */
  if(S.consent)root.hidden=true;
}
document.addEventListener('keydown',onKey);

window.cookieConsent={
  granted:function(c){return S.granted.indexOf(c)>=0},
  open:function(){
    if(root)return void(root.hidden=false);
    /* Not in the document: this visitor already decided, so the markup was
     * left out of the page. Fetch it now, the only round trip this design
     * ever makes, and only when someone asks to change their mind. */
    fetch('/api/consent/banner?locale='+encodeURIComponent(S.locale)).then(function(r){return r.text()}).then(function(html){
      var d=document.createElement('div');
      d.innerHTML=html;
      while(d.firstChild)document.body.appendChild(d.firstChild);
      var el=document.getElementById('cc-banner');
      if(el)bind(el);
    });
  },
  state:function(){return S}
};

/* The preferences panel.
 *
 * Each site keeps its own page, its own layout and its own chrome; it only
 * drops <div id="cc-preferences"></div> where the panel should sit. The panel
 * itself is the same markup as the banner, served by the Worker, so texts and
 * theme stay in one place.
 *
 * Withdrawing has to be as easy as granting, and a reachable page is easier
 * than a link that reopens a bottom sheet. */
/* Visual feedback for the preferences panel.
 *
 * On the banner, the confirmation of a choice is that it disappears. The panel
 * stays on screen: without this refresh, clicking "Accept all" from the
 * preferences page did record the choice (200 response, cookie set, trackers
 * started) while nothing on screen moved. A visitor could not tell their
 * choice had been taken. */
function stateLine(){
  return S.consent
    ? S.copy.recordedOn+' '+new Date(S.consent.at*1000).toLocaleDateString(S.locale)+' - '+S.copy.reference+' '+S.consent.id
    : S.copy.nothingRecorded;
}

function syncPanel(){
  var mnt=document.getElementById('cc-preferences');
  if(!mnt||!mnt.children.length)return;

  var line=mnt.querySelector('.state');
  if(line){
    line.setAttribute('role','status');
    line.textContent=stateLine();
    line.className='state saved';
    setTimeout(function(){line.className='state'},2000);
  }

  var boxes=mnt.querySelectorAll('.cats input');
  for(var i=0;i<boxes.length;i++){
    if(boxes[i].disabled)continue;
    boxes[i].checked=S.granted.indexOf(boxes[i].value)>=0;
  }
}

var mount=document.getElementById('cc-preferences');
if(mount){
  /* On the preferences page, the floating banner would duplicate and hide the
   * panel it is supposed to open. */
  if(root)root.hidden=true;
  fetch('/api/consent/banner?locale='+encodeURIComponent(S.locale)).then(function(r){return r.text()}).then(function(html){
    var d=document.createElement('div');
    d.innerHTML=html;
    var st=d.querySelector('style');
    if(st)document.head.appendChild(st);
    var dlg=d.querySelector('#cc-banner');
    if(!dlg)return;
    mount.className='cc always';
    mount.innerHTML=dlg.innerHTML;
    var sum=mount.querySelector('[data-act="detail"]');
    if(sum)sum.parentNode.removeChild(sum);
    var sv=mount.querySelector('[data-act="save"]');
    if(sv)sv.style.display='';
    var h=mount.querySelector('h2');
    if(h){
      var p=document.createElement('p');
      p.className='state';
      p.textContent=stateLine();
      h.parentNode.insertBefore(p,h.nextSibling);
    }
    mount.addEventListener('click',onClick);
  });
}

/* The sweep happens ON LOAD, not only when the choice is made.
 *
 * Measured on a preview: at the moment of the click the tracker's SDK is still
 * running, and it sets its cookie again between the deletion and the reload.
 * Here the tags are inert and nothing is running, so what is erased stays
 * erased.
 *
 * Idempotent, so harmless on every page, and it catches cookies set before this
 * tool existed. It never touches a granted category. */
S.swept=sweep(S.granted);
})();`;

/**
 * What is actually inlined into the page: the source above without comments or
 * indentation. Newlines stay, so no statement can run into the next one.
 */
export const RUNTIME = RUNTIME_SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]+/gm, '').replace(/\n{2,}/g, '\n');
