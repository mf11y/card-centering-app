from playwright.sync_api import sync_playwright
from pathlib import Path
import base64,json
import tempfile
out=Path(tempfile.mkdtemp(prefix='curved-dewarp-'));print('Artifacts:',out)
with sync_playwright() as p:
 b=p.chromium.launch(channel='msedge',headless=True)
 page=b.new_page(viewport={'width':1600,'height':1100})
 page.goto('http://127.0.0.1:5174/',wait_until='networkidle')
 result=page.evaluate("""async()=>{
 const {renderCurved}=await import('/src/lib/card-centering/curved-renderer.ts');
 const {warpImageToDataUrl}=await import('/src/lib/card-centering/warp.ts');
 const {createCurvedMapping}=await import('/src/lib/card-centering/curved-mapping.ts');
 const {computeWarpOutputSize}=await import('/src/lib/card-centering/geometry.ts');
 const c=document.createElement('canvas');c.width=400;c.height=500;const x=c.getContext('2d');
 x.fillStyle='#17252b';x.fillRect(0,0,400,500);
 const q=[{x:64,y:48},{x:320,y:48},{x:320,y:416},{x:64,y:416}],bows={top:0,right:0,bottom:-.04,left:0},zero={top:0,right:0,bottom:0,left:0};
 x.beginPath();x.moveTo(64,48);x.lineTo(320,48);x.lineTo(320,416);x.quadraticCurveTo(192,436.48,64,416);x.closePath();x.fillStyle='white';x.fill();
 x.save();x.clip();x.strokeStyle='#9ca3af';x.lineWidth=1;
 for(let y=60;y<450;y+=20){x.beginPath();x.moveTo(64,y);x.lineTo(320,y);x.stroke();}
 for(let a=80;a<320;a+=20){x.beginPath();x.moveTo(a,48);x.lineTo(a,445);x.stroke();}x.restore();
 x.beginPath();x.moveTo(64,416);x.quadraticCurveTo(192,436.48,320,416);x.strokeStyle='red';x.lineWidth=5;x.stroke();
 const image=new Image();image.src=c.toDataURL();await image.decode();
 const original=warpImageToDataUrl(image,q),z=renderCurved(image,q,zero),curved=renderCurved(image,q,bows);
 const again=renderCurved(image,q,bows);
 const size=computeWarpOutputSize(...q),m=createCurvedMapping(q,bows,size.width,size.height);
 const cpu=warpImageToDataUrl(image,q,(x,y)=>m.map(x/(size.width-1),y/(size.height-1)));
 const pixels=async(url)=>{const i=new Image();i.src=url;await i.decode();const a=document.createElement('canvas');a.width=i.width;a.height=i.height;const ctx=a.getContext('2d');ctx.drawImage(i,0,0);return {data:ctx.getImageData(0,0,i.width,i.height).data,w:i.width,h:i.height};};
 const a=await pixels(original),g=await pixels(curved.url),ref=await pixels(cpu);
 const reds=p=>{let n=0,total=0;for(let xx=10;xx<p.w-10;xx++){const i=((p.h-2)*p.w+xx)*4;if(p.data[i]>180&&p.data[i+1]<80)n++;total++;}return n/total;};
 let error=0;for(let i=0;i<g.data.length;i++)error+=Math.abs(g.data[i]-ref.data[i]);
 return {source:image.src,original,curved:curved.url,cpu,zeroExact:z.url===original,repeatExact:again.url===curved.url,backend:curved.backend,gpuError:curved.gpuError,ms:curved.ms,repeatMs:again.ms,originalRed:reds(a),curvedRed:reds(g),gpuCpuMAE:error/g.data.length};
}""")
 for key in ['source','original','curved','cpu']:
  (out/(key+'.png')).write_bytes(base64.b64decode(result.pop(key).split(',')[1]))
 print(json.dumps(result),flush=True)
 assert result['zeroExact'] and result['repeatExact']
 assert result['curvedRed']>.95 and result['originalRed']<.4
 assert result['gpuCpuMAE']<2
 page.get_by_role('button',name='Try Me',exact=True).click()
 preview=page.locator('img[alt="Warped preview"]');preview.wait_for(timeout=60000)
 before=preview.get_attribute('src')
 page.get_by_role('switch',name='Curved Edge Assist').check()
 page.wait_for_timeout(300)
 assert preview.get_attribute('src')==before
 handle=page.get_by_role('button',name='Adjust bottom edge bow',exact=True)
 handle.scroll_into_view_if_needed()
 r=handle.bounding_box();px=r['x']+r['width']/2;py=r['y']+r['height']/2
 page.mouse.move(px,py);page.mouse.down();page.mouse.move(px,py+8,steps=3);page.wait_for_timeout(100)
 assert preview.get_attribute('src')!=before, 'No live update during drag'
 page.mouse.up()
 handle.focus();page.keyboard.press('ArrowDown');page.wait_for_timeout(350)
 assert preview.get_attribute('src')!=before
 page.get_by_role('button',name='Reset bows',exact=True).click();page.wait_for_timeout(350)
 assert preview.get_attribute('src')==before
 print('PASS live bow changes Warp pixels; zero/reset restores exact original',flush=True)
 b.close()

