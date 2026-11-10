/* SSX 2012 / R78 — display-only score integrity.
 * This module never mutates the immutable Sheets score, changes rank order,
 * reconciles rider identity, or imports stale RiderNet scores. Values that
 * require interpretation are marked for review and retain their raw source.
 */
(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SSXScoreIntegrity=api;
})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  const MODES=Object.freeze({0:'race',1:'race',2:'trick',3:'survive',5:'survive',
    board:'race',wings:'race',trick:'trick',survive:'survive',special:'survive'});
  function modeKind(mode){
    const key=String(mode??'').toLowerCase();
    return Object.prototype.hasOwnProperty.call(MODES,key)?MODES[key]:'unknown';
  }
  function commaGroups(digits){
    return digits.replace(/\B(?=(\d{3})+(?!\d))/g,',');
  }
  function integerFromScientific(value){
    const match=/^(\d{1,15})(?:\.(\d{1,12}))?[eE]\+?(\d{1,2})$/.exec(value);
    if(!match)return null;
    const frac=match[2]||'',shift=Number(match[3]);
    if(shift<frac.length||shift>18||match[1].length+shift>24)return null;
    const digits=match[1]+frac+'0'.repeat(shift-frac.length);
    return commaGroups(BigInt(digits).toString());
  }
  function format(value,mode){
    const source=String(value??''),raw=source.trim(),kind=modeKind(mode);
    const base={raw,display:raw,kind,status:'unchanged',changed:false};
    if(!raw)return {...base,status:'invalid'};
    let display=null,status='verified-format';
    if(kind==='race'){
      const m=/^(\d{1,2}):([0-5]\d)\.(\d{2})$/.exec(raw);
      if(m)display=m[1].padStart(2,'0')+':'+m[2]+'.'+m[3];
    }else if(kind==='trick'){
      if(/^\d{1,18}$/.test(raw))display=commaGroups(BigInt(raw).toString());
      else if(/^\d{1,3}(?:,\d{3})+$/.test(raw))display=raw;
      else display=integerFromScientific(raw);
    }else if(kind==='survive'){
      // Ambiguous comma used for both group and decimal in legacy Sheets:
      // 10,787,35m -> 10,787.35 m. Display is a hypothesis requiring
      // source review; do not treat as certified numeric evidence.
      const legacy=/^(\d{1,3}(?:,\d{3})+),(\d{1,2})\s*(m|km)$/i.exec(raw);
      if(legacy){
        display=legacy[1]+'.'+legacy[2].padEnd(2,'0')+' '+legacy[3];
        status='review-inferred-separators';
      }else{
        const clean=/^(\d{1,15})(?:\.(\d{1,3}))?\s*(m|km)$/i.exec(raw);
        const grouped=/^(\d{1,3}(?:,\d{3})+)(?:\.(\d{1,3}))?\s*(m|km)$/i.exec(raw);
        const m=clean||grouped;
        if(m)display=(clean?commaGroups(m[1]):m[1])+(m[2]?'.'+m[2]:'')+' '+m[3];
      }
    }
    if(display===null)return {...base,status:'review-unparsed'};
    return {raw,display,kind,status,changed:display!==raw};
  }
  function apply(node,value,mode){
    if(!node)return null;
    const result=format(value,mode);
    node.textContent=result.display;
    node.dataset.ssxOriginalScore=result.raw;
    node.dataset.ssxScoreStatus=result.status;
    if(result.changed||result.status.startsWith('review-')){
      const pt=String(node.ownerDocument?.documentElement?.lang||'').startsWith('pt');
      const prefix=pt?'Valor original: ':'Original source value: ';
      const suffix=result.status.startsWith('review-')
        ?(pt?' · Formatação pendente de conferência':' · Formatting requires source review'):'';
      node.title=prefix+result.raw+suffix;
    }
    return node;
  }
  return Object.freeze({format,apply,modeKind});
});
