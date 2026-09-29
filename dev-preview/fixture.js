// Made-up rows shaped like the real ones. Local preview only.
const H='h1', HUB='hub1', GOV='gov1', PLAT='plat1', LAB='lab1', PROC='proc1', BUY='buy1', S1='s1', S2='s2', P1='p1', P2='p2'
export const IDS={H,HUB,GOV,PLAT,LAB,BUY}
const ago=h=>new Date(Date.now()-h*3.6e6).toISOString(), ahead=h=>new Date(Date.now()+h*3.6e6).toISOString()
const b=(id,org,ref,at,ai,fm,age,conf,mass,mission=null)=>({id,org_id:org,mission_id:mission,batch_ref:ref,arsenic_total:at,arsenic_inorganic:ai,foreign_matter:fm,age_hours:age,chain_valid:true,signature_valid:true,measurement_conf:conf,wet_mass_t:mass,created_at:ago(30)})
const r=(d,band,op,low,high)=>({id:d+band,dimension:d,band,op,low,high})
const orgs=[[PLAT,'CIIN Platform','government'],[GOV,'Jamaica Coastal Authority','government'],[HUB,'NEG01 Recovery Hub','recovery_hub'],[H,'Negril Resorts Group','hotel'],[LAB,'CIIN Accredited Lab','university_lab'],[PROC,'Negril Bioprocessing Ltd','processor'],[BUY,'Caribbean Alginate Co.','buyer']]
  .map(([id,name,role])=>({id,name,role,country_code:'JM',approved:true,capacity_t:role==='recovery_hub'?90:null,created_at:ago(60)}))
export const DB={
 beaches:[{id:'b1',country_code:'JM',name:'Bloody Bay Beach',parish:'Hanover',licensed:false,lat:18.3436,lng:-78.3366,precision:'beach',located_by:'Mapped beach'}],
 hotels:[{id:'ho1',country_code:'JM',name:'Sample Hotel',kind:'hotel',lat:18.47,lng:-77.92,place:'Montego Bay'}],
 properties:[{id:P1,org_id:H,name:'Negril Beach Resort',country_code:'JM',access_gate:'Main service gate, south',access_hours:'6:00 am to 6:00 pm',contact_name:'Maria Lopez',contact_phone:'+1 876 555 0123',access_notes:null},{id:P2,org_id:H,name:'Ocho Rios Bay Hotel',country_code:'JM'}],
 beach_segments:[
  {id:S1,org_id:H,property_id:P1,name:'Long Bay — main frontage',lat:18.305228,lng:-78.33935,length_m:400,path:[[18.282075,-78.345615],[18.295869,-78.339131],[18.316053,-78.337829],[18.332827,-78.337896]]},
  {id:S2,org_id:H,property_id:P2,name:'Ocho Rios Bay Hotel — frontage',lat:18.41,lng:-77.105,length_m:200,path:null}],
 organizations:orgs,
 missions:[
  {id:'m1',org_id:H,segment_id:S1,title:'Long Bay main — landed',tonnes:40,status:'in_progress',eta_at:ago(30),access_state:'granted',created_at:ago(30),line_step:4,authority_required:false,alert_level:'high',tonnes_basis:'indicative_length_heuristic'},
  {id:'m3',org_id:H,segment_id:S2,title:'Ocho Rios Bay — severe offshore',tonnes:27,status:'proposed',eta_at:ahead(30),access_state:'pending',created_at:ago(3),line_step:0,authority_required:true,alert_level:'severe'}],
 mission_hubs:[{id:'mh1',org_id:HUB,mission_id:'m1',hub_name:'NEG01 Recovery Hub',share_tonnes:null,accepted:true},{id:'mh2',org_id:HUB,mission_id:'m3',hub_name:'NEG01 Recovery Hub',share_tonnes:null,accepted:false}],
 cleanup_visits:[{id:'v1',mission_id:'m1',org_id:HUB,arrives_at:ahead(6),finishes_at:ahead(14),crew:8,trucks:3,note:'Entry by the south service gate',status:'confirmed',reply:null,created_at:ago(20)}],
 landing_reports:[{id:'l1',segment_id:S1,org_id:H,mission_id:'m1',landed_at:ago(39),extent:'heavy',note:'Thick line along the whole frontage, strong smell',photo:null,cleared_at:null}],
 removals:[{id:'rm1',mission_id:'m1',org_id:HUB,removed_at:ago(5),tonnes:18.5,tonnes_basis:'estimated',destination_org:PROC,destination_text:null,note:'First pass, north end',status:'recorded',photo_before:null,photo_after:null,created_at:ago(5)}],
 beach_rules:[{id:'ru1',country_code:'JM',segment_id:null,kind:'turtle_nesting',rule:'No machinery on the sand between sunset and sunrise',from_date:'2026-05-01',to_date:'2026-11-30',active:true}],
 samples:[{id:'sa1',sample_ref:'S-CP-JAM-NEG01-0022',batch_id:'b2',mission_id:'m1',org_id:HUB,lab_org_id:LAB,taken_at:ago(8),sent_at:ago(7),status:'sent',note:'Courier, seal 4471'},
          {id:'sa2',sample_ref:'S-CP-JAM-NEG01-0021',batch_id:'b1',mission_id:'m1',org_id:HUB,lab_org_id:LAB,taken_at:ago(50),sent_at:ago(49),received_at:ago(40),status:'received',note:null}],
 batches:[b('b1',HUB,'CP-JAM-NEG01-0021',82,null,2.5,14,'screened',60,'m1'),b('b2',HUB,'CP-JAM-NEG01-0022',90,null,4,55,'screened',40,'m1'),b('b3',HUB,'CP-JAM-NEG01-0023',30,null,1,12,'screened',25,'m1'),
  b('b10',BUY,'CP-JAM-BUY-0051',28,1.2,0.8,10,'confirmed',80),b('b9',LAB,'CP-JAM-LAB-0043',30,1.4,1,12,'confirmed',40)],
 alert_prefs:[{profile_id:'u1',phone:'+18765550123',sms:true,whatsapp:false,summary:true}],
 alerts:[
  {id:'a1',profile_id:'u1',subject:'Overdue: Long Bay — main frontage not cleared after 48 hours',body:'OVERDUE. 48 hours have passed since this landing and no removal has been signed off.',level:'urgent',channel:'email',status:'sent',created_at:ago(2)},
  {id:'a2',profile_id:'u1',subject:'Overdue: Long Bay — main frontage not cleared after 48 hours',body:'CIIN URGENT',level:'urgent',channel:'sms',status:'not_configured',detail:'No SMS service is set up.',created_at:ago(2)},
  {id:'a3',profile_id:'u1',subject:'Clean-up proposed for Long Bay — main frontage',body:'NEG01 Recovery Hub proposes the following clean-up visit.',level:'action',channel:'email',status:'sent',created_at:ago(20)},
  {id:'a4',profile_id:'u1',subject:'NEG01 Recovery Hub reports this clean-up visit as completed',body:'For information.',level:'info',channel:'summary',status:'held',created_at:ago(5)}],
 invoices:[], cost_rates:[{id:'r1',org_id:HUB,unit:'truck',amount:480,effective_to:null}], load_summaries:[], invitations:[], agent_proposals:[{id:'pr3',mission_id:'m3',created_at:ago(3)}],
 profiles:[{id:'u1',full_name:'Owner',level:'org_admin',property_id:null,org_id:H}],
 grading_rules:[r('arsenic_inorganic','A','<=',null,2),r('arsenic_inorganic','B','between',2,40),r('arsenic_total','C','>',40,null),r('foreign_matter','A','<=',null,2),r('foreign_matter','B','between',2,5),r('age_hours','A','<=',null,48),r('age_hours','B','between',48,72)],
 grading_policy:[{id:1,compounding_b_to_c:3,arsenic_breaks_ties:true,closure_conforming:15,closure_conditional:30}],
 segment_baselines:[{segment_id:S1,afai_window:'7D',p75:15.08,p90:18.59,p95:21.54,p99:28.02},{segment_id:S2,afai_window:'7D',p75:15,p90:19,p95:22,p99:29}],
}
const RPC={country_directory:()=>orgs, site_access:()=>[{property_id:P1,property_name:'Negril Beach Resort',...DB.properties[0]}]}
const note=t=>{document.body.dataset.writes=(document.body.dataset.writes||'')+' | '+t}
const real=window.fetch.bind(window)
const json=x=>new Response(JSON.stringify(x),{status:200,headers:{'Content-Type':'application/json'}})
window.fetch=async(input,init)=>{
  const url=typeof input==='string'?input:input.url
  const rpc=url.match(/\/rest\/v1\/rpc\/([a-z_]+)/)
  if(rpc){ if(RPC[rpc[1]]) return json(RPC[rpc[1]]()); note('rpc '+rpc[1]+' '+(init?.body||'')); return json({report:'new',mission:'m1',mission_raised:false}) }
  if(/functions\/v1\/(notify|visit-notify|baseline)/.test(url)){ note('fn '+url.split('/').pop()+' '+(init?.body||'')); return json({ok:true}) }
  if(url.includes('/storage/v1/')){ note('storage'); return json({Key:'x',signedURL:''}) }
  const m=url.match(/\/rest\/v1\/([a-z_]+)\?(.*)$/)||url.match(/\/rest\/v1\/([a-z_]+)$/)
  if(!m) return real(input,init)
  const method=(init?.method||'GET').toUpperCase()
  if(method!=='GET'&&method!=='HEAD'){ note(method+' '+m[1]+' '+(init?.body||'')); return json({id:'new'}) }
  let rows=[...(DB[m[1]]||[])]
  const q=new URLSearchParams(m[2]||'')
  for(const [k,v] of q){
    if(['select','order','limit','offset'].includes(k)) continue
    if(k==='or'){const parts=v.slice(1,-1).split(',').map(p=>p.split('.'));rows=rows.filter(r=>parts.some(([c,,val])=>String(r[c])===val));continue}
    if(v.startsWith('eq.')) rows=rows.filter(r=>String(r[k])===v.slice(3))
    else if(v.startsWith('neq.')) rows=rows.filter(r=>String(r[k])!==v.slice(4))
    else if(v.startsWith('is.null')) rows=rows.filter(r=>r[k]==null)
    else if(v.startsWith('in.(')){const set=v.slice(4,-1).split(',').map(s=>s.replace(/"/g,''));rows=rows.filter(r=>set.includes(String(r[k])))}
  }
  if((q.get('select')||'').includes('missions(')) rows=rows.map(r=>({...r,missions:DB.missions.find(x=>x.id===r.mission_id)||null}))
  return json(rows)
}
