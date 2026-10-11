(function(){
  var t='dark',a='#c8ff00';
  try{t=localStorage.getItem('it-theme')||t;a=localStorage.getItem('it-accent')||a;}catch(e){}
  if(t==='light'&&a==='#ffffff')a='#000000';
  if(t!=='light'&&a==='#000000')a='#ffffff';
  var d=document.documentElement;
  d.setAttribute('data-theme',t);
  d.style.setProperty('--accent',a);
  d.style.setProperty('--accent-dim','rgba('+parseInt(a.slice(1,3),16)+','+parseInt(a.slice(3,5),16)+','+parseInt(a.slice(5,7),16)+',0.12)');
})();
