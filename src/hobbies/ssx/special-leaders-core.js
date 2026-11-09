/* SSX 2012 — archived leader accounting; pure, deterministic and read-only.
 * A ranking exists only when the archived Sheets row explicitly says #1.
 * No score comparisons between courses, no Ozmonet nickname guesses.
 */
(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SSXSpecialLeaders=api;
})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  function safe(value){return typeof value==='string'?value.trim():'';}
  function valid(row){
    return row&&Number.isInteger(row.trackId)&&row.trackId>=0
      &&Number.isInteger(row.mode)&&Number.isInteger(row.position)&&row.position>0
      &&safe(row.category)&&safe(row.rider)&&safe(row.score);
  }
  function platformKey(value){return safe(value)||'__unspecified__';}
  function scope(rows,category,mode,platform){
    if(!Array.isArray(rows))throw new TypeError('Expected array of immutable source rows');
    if(!safe(category)||!Number.isInteger(mode)||!safe(platform))
      throw new TypeError('Category, numeric mode and platform are mandatory');
    return rows.filter(row=>valid(row)&&row.category===category
      &&row.mode===mode&&platformKey(row.platform)===platform);
  }
  function calculate(rows,category,mode,platform){
    const selected=scope(rows,category,mode,platform);
    const tracks=new Map();
    for(const row of selected){
      if(!tracks.has(row.trackId))tracks.set(row.trackId,[]);
      tracks.get(row.trackId).push(row);
    }
    const winners=[],conflicts=[],withoutFirst=[];
    let duplicateRows=0;
    for(const [trackId,records] of [...tracks].sort((a,b)=>a[0]-b[0])){
      const first=records.filter(row=>row.position===1);
      if(!first.length){
        withoutFirst.push({trackId,track:safe(records[0]?.track),rows:records.length});
        continue;
      }
      // Identity aliases are intentionally NOT consolidated without Ozmonet ID.
      // Duplicate identical rows are counted once; distinct #1 claims conflict.
      const unique=new Map();
      for(const row of first){
        const fingerprint=JSON.stringify([row.rider,row.score]);
        if(unique.has(fingerprint)){
          duplicateRows++;
          const current=unique.get(fingerprint);
          if(!current.proof&&row.proof)unique.set(fingerprint,row);
        }else unique.set(fingerprint,row);
      }
      if(unique.size!==1){
        conflicts.push({
          trackId,track:safe(records[0]?.track),
          claims:[...unique.values()].map(row=>({rider:row.rider,score:row.score,proof:Boolean(row.proof)}))
        });
        continue;
      }
      winners.push([...unique.values()][0]);
    }
    const people=new Map();
    for(const row of winners){
      const name=safe(row.rider);
      if(!people.has(name))people.set(name,{name,wins:0,proofs:0,tracks:[]});
      const rider=people.get(name);
      rider.wins++;
      rider.proofs+=row.proof?1:0;
      rider.tracks.push(row.trackId);
    }
    // Score/distance is intentionally not a tie breaker between unlike tracks.
    const podium=[...people.values()].sort((a,b)=>
      b.wins-a.wins||a.name.localeCompare(b.name,'en',{sensitivity:'variant'})
    ).slice(0,3).map((person,i)=>({
      rank:i+1,name:person.name,wins:person.wins,proofs:person.proofs,tracks:person.tracks.slice()
    }));
    return {
      source:'google-sheets-archive',category,mode,platform,
      sourceRows:selected.length,trackCount:tracks.size,
      leaders:winners,leaderCount:winners.length,
      contenders:people.size,podium,
      collisions:conflicts,withoutFirst,duplicateRows,
      identityStatus:'unverified-until-exact-ozmonet-player-id',
      certifiedCurrent:false
    };
  }
  return Object.freeze({scope,calculate,platformKey});
});
