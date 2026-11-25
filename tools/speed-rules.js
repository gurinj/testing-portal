// node tools/speed-rules.js [n]: time per rule file on a clean generated file (after node tools/build.js)
const path=require('path'),fs=require('fs');const ROOT=process.cwd();
globalThis.TPSaxes=require(path.join(ROOT,'tools/vendor/node_modules/saxes'));
const SaxonJS=require(path.join(ROOT,'tools/vendor/node_modules/saxon-js'));
const WORKER_FUNCTIONS=(fs.readFileSync(path.join(ROOT,'js/validation/rules-worker.js'),'utf8').match(/'functions\/[^']+\.js'/g)||[]).map(x=>x.slice(1,-1));
for (const f of [...WORKER_FUNCTIONS,'findings/place.js','findings/from-svrl.js','findings/scan.js','rules-core.js']) require(path.join(ROOT,'js/validation',f));
const TP=globalThis.TP,F=TP.functions;const rj=p=>JSON.parse(fs.readFileSync(path.join(ROOT,p),'utf8'));
const K={'iban-registry':'iban','external-codes':'codes','payment-areas':'areas','clearing-systems':'clearing'};
TP.reference={};for(const r of ['countries','currencies','iban-registry','external-codes','payment-areas','clearing-systems'])TP.reference[K[r]||r]=rj(`config/reference/${r}.json`);
const SITE=path.join(ROOT,'dist/site');const man=rj('dist/site/rules/manifest.json');
const sets=man.ruleSets.map(s=>({...s,sef:JSON.parse(fs.readFileSync(path.join(SITE,s.file),'utf8'))}));
const gen=require(path.join(ROOT,'js/dev/test-file-generator.js'));
const n=+process.argv[2]||10000;
(async()=>{for (const v of ['03','09']) { const xml=gen.generate({version:v,transactions:n,blocks:4,uetr:true,lei:true});
 const cfg=rj('config/countries/AT.json');const ctx={country:'AT',countryConfig:cfg,settings:F.settingsFor(rj('config/settings.json'),cfg)};
 await TP.rulesCore.runRuleSets(SaxonJS,sets,xml,v,'AT',ctx);
 const t=Date.now();const r=await TP.rulesCore.runRuleSets(SaxonJS,sets,xml,v,'AT',ctx);
 console.log(v, n, 'total', Date.now()-t, 'ms', 'findings', r.findings.length, JSON.stringify(Object.fromEntries(Object.entries(r.timings.sets).map(([k,x])=>[k,Math.round(x)]))), 'parse', Math.round(r.timings.parse), 'scan', Math.round(r.timings.scan));
}})();
