(function(){
  'use strict';
  var input=document.getElementById('faq-search');
  var form=document.querySelector('.r4700-faq-search');
  var status=document.getElementById('faq-result-status');
  var empty=document.getElementById('faq-no-results');
  if(!input||!status||!empty)return;
  var groups=Array.from(document.querySelectorAll('#faq-groups .faq-group'));
  var total=groups.reduce(function(sum,group){return sum+group.querySelectorAll('[data-faq-item]').length;},0);
  function normalize(value){
    return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR').trim();
  }
  function resultMessage(visible,hasQuery){
    var lang=document.documentElement.lang;
    if(lang==='en')return hasQuery?visible+' of '+total+' questions found.':total+' questions available.';
    return hasQuery?visible+' de '+total+' perguntas encontradas.':total+' perguntas disponíveis.';
  }
  function filter(){
    var words=normalize(input.value).split(/\s+/).filter(Boolean);
    var shownTotal=0;
    groups.forEach(function(group){
      var shown=0;
      group.querySelectorAll('[data-faq-item]').forEach(function(item){
        var haystack=normalize(item.textContent);
        var visible=words.every(function(word){return haystack.includes(word);});
        item.hidden=!visible;
        if(visible)shown++;
      });
      group.hidden=shown===0;
      shownTotal+=shown;
      var link=document.querySelector('.r4700-faq-topics a[href="#'+group.id+'"]');
      if(link){
        link.hidden=shown===0;
        var count=link.querySelector('.r4700-topic-count');
        if(count)count.textContent=String(shown);
      }
    });
    empty.hidden=shownTotal!==0;
    status.textContent=resultMessage(shownTotal,words.length>0);
  }
  if(form)form.addEventListener('submit',function(event){event.preventDefault();});
  input.addEventListener('input',filter);
  input.addEventListener('search',filter);
  input.addEventListener('keydown',function(event){
    if(event.key==='Escape'&&input.value){event.preventDefault();input.value='';filter();}
  });
  filter();
})();
