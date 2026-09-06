import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='msedge', headless=True)
    page = browser.new_page()
    page.goto(os.environ.get('REVIEW_TEST_URL', 'http://127.0.0.1:4180'))
    results = page.evaluate('''async () => {
        const m=await import('/src/lib/recent-upload-cache.ts');
        const {CARD_PROCESSING_VERSION, processingVersion, CARD_PIPELINE_COMPAT_VERSION, OUTER_MODEL_ASSET_HASH, LEARNED_RANKER_ASSET_HASH}=await import('/src/lib/card-centering/processing-version.ts');
        if(processingVersion(CARD_PIPELINE_COMPAT_VERSION,OUTER_MODEL_ASSET_HASH,LEARNED_RANKER_ASSET_HASH)!==CARD_PROCESSING_VERSION)throw Error('determinism');
        if(processingVersion('pipeline-v2',OUTER_MODEL_ASSET_HASH,LEARNED_RANKER_ASSET_HASH)===CARD_PROCESSING_VERSION)throw Error('pipeline key');
        if(processingVersion(CARD_PIPELINE_COMPAT_VERSION,OUTER_MODEL_ASSET_HASH,'changed-weight-hash')===CARD_PROCESSING_VERSION)throw Error('model key');
        const f=x=>new File([x],'same.png',{type:'image/png'});
        const a=await m.lookupRecentUpload(f('A')); if(a.hit)throw Error('first hit');
        const result={ok:true,mask_data_url:'data:image/png;base64,AA==',corners:['top-left','top-right','bottom-right','bottom-left'].map((id,i)=>({id,x:i,y:i}))};
        await m.saveRecentDetection(a.sha256,result);
        const hit=await m.lookupRecentUpload(f('A')); if(!hit.hit||!hit.result)throw Error('reuse');
        if(!(await m.lookupRecentUpload(new File(['A'],'renamed.jpg',{type:'image/png'}))).hit)throw Error('renamed duplicate');
        const stale=await m.lookupRecentUpload(f('A'),'future'); if(!stale.hit||stale.result||await stale.blob.text()!=='A')throw Error('version');
        const checkDb=await new Promise(res=>{const r=indexedDB.open('card-centering-recent-uploads');r.onsuccess=()=>res(r.result)});
        const read=()=>new Promise(res=>{const r=checkDb.transaction('images').objectStore('images').get(a.sha256);r.onsuccess=()=>res(r.result)});
        const expired=await read();
        if(expired.analysis || expired.byteSize!==1 || expired.originalFileName!=='same.png' || !expired.createdAt)throw Error('source metadata');
        await m.saveRecentDetection(a.sha256,result,'future');
        const fresh=await read();
        if(fresh.analysis.processingVersion!=='future'||!fresh.analysis.processedAt||fresh.createdAt!==expired.createdAt)throw Error('fresh analysis');
        // Simulate the old flat schema and confirm it remains an image hit, never a recapture.
        await new Promise(res=>{const tx=checkDb.transaction('images','readwrite');tx.objectStore('images').put({sha256:a.sha256,blob:expired.blob,mimeType:expired.mimeType,originalSize:1,timestamp:expired.createdAt,lastUsedAt:expired.lastUsedAt,resultVersion:CARD_PROCESSING_VERSION,result});tx.oncomplete=res});
        const legacy=await m.lookupRecentUpload(f('A'));
        if(!legacy.hit||legacy.result||await legacy.blob.text()!=='A')throw Error('legacy migration');
        const migrated=await read();
        if(migrated.createdAt!==expired.createdAt||migrated.byteSize!==1||'resultVersion' in migrated)throw Error('migration metadata');
        await new Promise(res=>{const tx=checkDb.transaction('images','readwrite');tx.objectStore('images').put({...migrated,analysis:{processingVersion:CARD_PROCESSING_VERSION,processedAt:Date.now(),result:{...result,corners:[null]}}});tx.oncomplete=res});
        const malformed=await m.lookupRecentUpload(f('A'));
        if(!malformed.hit||malformed.result||await malformed.blob.text()!=='A')throw Error('malformed analysis');
        checkDb.close();
        if((await m.lookupRecentUpload(f('B'))).hit)throw Error('filename');
        for(const x of ['C','D','E'])await m.lookupRecentUpload(f(x));
        await m.lookupRecentUpload(f('B'));
        await m.lookupRecentUpload(f('F'));
        const db=await new Promise(res=>{const r=indexedDB.open('card-centering-recent-uploads');r.onsuccess=()=>res(r.result)});
        const rows=await new Promise(res=>{const r=db.transaction('images').objectStore('images').getAll();r.onsuccess=()=>res(r.result)});db.close();
        if(rows.length!==5||rows.some(r=>r.sha256===a.sha256))throw Error('eviction');
        const order=await Promise.all(rows.sort((a,b)=>a.lastUsedAt-b.lastUsedAt).map(r=>r.blob.text()));
        if(order.join('')!=='CDEBF')throw Error('LRU promotion');
        return {miss:true,hit:true,renamedDuplicate:true,malformedAnalysis:true,lruPromotion:true,versionInvalidation:true,sourceSurvivesVersionChange:true,analysisTimestamp:true,legacyMigration:true,sameFilenameDifferentBytes:true,eviction:true,entries:rows.length};
    }''')
    page.reload()
    assert page.evaluate("""async()=>{const m=await import('/src/lib/recent-upload-cache.ts');return (await m.lookupRecentUpload(new Blob(['F'],{type:'image/png'}))).hit}""")
    results['refreshPersistence'] = True
    assert page.evaluate("""async()=>{const m=await import('/src/lib/recent-upload-cache.ts');const old=indexedDB.open;indexedDB.open=()=>{throw Error('disabled')};try{return !(await m.lookupRecentUpload(new Blob(['Z']))).sha256}finally{indexedDB.open=old}}""")
    results['unavailableFallback'] = True
    browser.close()
    browser = pw.chromium.launch(channel='msedge', headless=True)
    page = browser.new_page()
    captures=[]
    page.route('**/api/log-upload',lambda r:(captures.append(1),r.fulfill(json={'ok':True})))
    page.route('**/src/lib/card-centering/api.ts*',lambda r:r.fulfill(content_type='text/javascript',body="""export async function preloadInferenceModel(){window.__ready=true};export async function inferCorners(file){window.__inferences=(window.__inferences||0)+1;return {ok:true,mask_data_url:'data:image/png;base64,AA==',corners:[{id:'top-left',x:20,y:20},{id:'top-right',x:200,y:20},{id:'bottom-right',x:200,y:280},{id:'bottom-left',x:20,y:280}]}}"""))
    page.goto(os.environ.get('REVIEW_TEST_URL', 'http://127.0.0.1:4180'))
    img=str(Path(__file__).resolve().parents[1] / 'static' / 'tryme.webp')
    page.wait_for_function('window.__ready===true')
    page.locator('#image-upload').set_input_files(img)
    page.wait_for_function('window.__inferences===1')
    page.wait_for_timeout(1500)
    page.get_by_role('button',name='Reset',exact=True).click()
    page.wait_for_function('window.__ready===true')
    page.locator('#image-upload').set_input_files(img)
    page.wait_for_function("window.__recentUploadCache?.cache==='hit' && window.__recentUploadCache?.inference==='reused'")
    page.wait_for_timeout(1800)
    assert len(captures)==1, captures
    assert page.evaluate('window.__inferences')==1
    results['uiDuplicateSingleCapture']=True
    results['uiDuplicateSingleInference']=True
    guide=page.locator('[data-guide-key="top"]')
    guide.focus()
    before=guide.evaluate('(el)=>el.style.top')
    guide.press('ArrowDown')
    page.wait_for_timeout(100)
    assert guide.evaluate('(el)=>el.style.top') != before
    results['manualGuideNudgeAfterRestore']=True
    page.reload()
    page.wait_for_function('window.__ready===true')
    page.locator('#image-upload').set_input_files(img)
    page.wait_for_function("window.__recentUploadCache?.inference==='reused'")
    page.wait_for_timeout(1200)
    assert len(captures)==1
    assert page.evaluate('window.__inferences||0')==0
    results['uiReloadReusesInference']=True
    page.evaluate("""async()=>{const db=await new Promise(res=>{const r=indexedDB.open('card-centering-recent-uploads');r.onsuccess=()=>res(r.result)});await new Promise(res=>{const tx=db.transaction('images','readwrite'),st=tx.objectStore('images');const r=st.getAll();r.onsuccess=()=>{for(const row of r.result)st.put({...row,analysis:{...row.analysis,processingVersion:'pipeline-v1__outer-unchanged__ranker-OLDHASH'}})};tx.oncomplete=res});db.close()}""")
    page.reload()
    page.wait_for_function('window.__ready===true')
    page.locator('#image-upload').set_input_files(img)
    page.wait_for_function('window.__inferences===1')
    assert len(captures)==1
    results['uiStaleInferenceRecomputedWithoutCapture']=True
    page.wait_for_timeout(500)
    assert page.evaluate("""async()=>{const {CARD_PROCESSING_VERSION}=await import('/src/lib/card-centering/processing-version.ts');const db=await new Promise(res=>{const r=indexedDB.open('card-centering-recent-uploads');r.onsuccess=()=>res(r.result)});const rows=await new Promise(res=>{const r=db.transaction('images').objectStore('images').getAll();r.onsuccess=()=>res(r.result)});db.close();return rows.length===1&&rows[0].analysis.processingVersion===CARD_PROCESSING_VERSION}""")
    results['freshModelKeySaved']=True
    page.evaluate("""async()=>{const db=await new Promise(res=>{const r=indexedDB.open('card-centering-recent-uploads');r.onsuccess=()=>res(r.result)});await new Promise(res=>{const tx=db.transaction('images','readwrite'),st=tx.objectStore('images');const r=st.getAll();r.onsuccess=()=>{for(const row of r.result)st.put({...row,analysis:{...row.analysis,processingVersion:row.analysis.processingVersion.replace('pipeline-v1','pipeline-v0')}})};tx.oncomplete=res});db.close()}""")
    page.reload()
    page.wait_for_function('window.__ready===true')
    page.locator('#image-upload').set_input_files(img)
    page.wait_for_function('window.__inferences===1')
    assert len(captures)==1
    results['pipelineOnlyChangeRerunsWithoutCapture']=True
    page.wait_for_timeout(1200)
    # A new byte sequence remains a unique upload even with the same filename.
    page.get_by_role('button',name='Reset',exact=True).click()
    page.locator('#image-upload').set_input_files({'name':Path(img).name,'mimeType':'image/webp','buffer':Path(img).read_bytes()+b'new-bytes'})
    page.wait_for_function('window.__inferences===2')
    assert len(captures)==2
    results['uniqueCaptureUnchanged']=True
    browser.close()
# Isolated browser contexts leave the user's actual cache untouched.
print(results)
