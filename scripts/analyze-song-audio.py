"""Independent FFmpeg EBU R128/true-peak measurements and exact activity plots.
Usage: python3 scripts/analyze-song-audio.py DIRECTORY
Requires ffmpeg, numpy and matplotlib; never substitutes measurements for listening.
"""
import hashlib,json,math,pathlib,re,subprocess,sys
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
root=pathlib.Path(sys.argv[1]);report=json.loads((root/'report.json').read_text());measurements=[]
for case in report['cases']:
    file=root/case['file']
    raw=subprocess.run(['ffmpeg','-hide_banner','-i',str(file),'-af','ebur128=peak=true','-f','null','-'],capture_output=True,text=True,check=True).stderr
    (root/(file.stem+'-ebu.txt')).write_text(raw)
    summary=raw[raw.rfind('Summary:'):]
    integrated=re.search(r'I:\s+(-?[\d.]+) LUFS',summary);peak=re.search(r'Peak:\s+(-?[\d.]+) dBFS',summary);lra=re.search(r'LRA:\s+([\d.]+) LU',summary)
    measurements.append({'file':file.name,'sha256':hashlib.sha256(file.read_bytes()).hexdigest(),'integratedLufs':float(integrated[1]) if integrated else None,'truePeakDbfs':float(peak[1]) if peak else None,'loudnessRangeLu':float(lra[1]) if lra else None,'scope':'isolated muted-source render' if case['stem'] else 'complete mix'})
    subprocess.run(['ffmpeg','-y','-v','error','-i',str(file),'-map_metadata','-1','-c:a','flac',str(root/(file.stem+'.flac'))],check=True)
(root/'independent-measurements.json').write_text(json.dumps(measurements,indent=2))
# Per-bar note onsets; this is activity evidence, not a harmony or novelty score.
fig,axes=plt.subplots(2,1,figsize=(14,6),sharex=True,layout='constrained')
for ax,name,title in zip(axes,['before','after'],['Previous section-slicing workflow','Seeded SongPlan workflow']):
    p=json.loads((root/(name+'.aidaw.json')).read_text())['project'];tracks=[t for t in p['tracks'] if t['type']=='midi'];bars=p['arrangementLengthBars'];grid=np.zeros((len(tracks),bars))
    for i,t in enumerate(tracks):
        for c in t['clips']:
            for n in c['notes']:
                if c['startTime']<=n['time']<c['startTime']+c['length'] and 0<=n['time']<bars*4:grid[i,int(n['time']//4)]+=1
    image=ax.imshow(np.log1p(grid),aspect='auto',origin='upper',extent=[1,bars+1,len(tracks)-.5,-.5],cmap='magma',vmin=0,vmax=math.log(65));ax.set_yticks(range(len(tracks)),[t['archetype'] for t in tracks]);ax.set_title(title,loc='left');ax.set_ylabel('Musical role')
    if name=='after':
        for s in p['songPlan']['sections']:ax.axvline(1+s['fromBeat']/4,color='white',alpha=.5,lw=.7)
axes[-1].set_xlabel('Bar — colour shows log(1 + MIDI note onsets), not audio loudness')
fig.savefig(root/'arrangement-comparison.png',dpi=160);plt.close(fig)
# Blinded listening files use equal integrated-loudness target; raw FLAC remains untouched.
for label,name in [('A','after'),('B','before')]:
    subprocess.run(['ffmpeg','-y','-v','error','-i',str(root/(name+'.wav')),'-af','loudnorm=I=-16:TP=-1.5:LRA=11','-map_metadata','-1','-c:a','libmp3lame','-b:a','192k',str(root/('Blind-'+label+'.mp3'))],check=True)
(root/'blind-key.json').write_text(json.dumps({'A':'after','B':'before','normalization':'FFmpeg loudnorm -16 LUFS, -1.5 dBTP, one-pass listening copies; raw audio untouched'},indent=2))
(root/'producer-rubric.csv').write_text('listener,blind_id,groove_1_to_5,harmony_1_to_5,layering_1_to_5,transitions_1_to_5,balance_1_to_5,ending_1_to_5,releaseable_yes_no,timestamped_notes\n,A,,,,,,,,,\n,B,,,,,,,,,\n')
print(json.dumps(measurements,indent=2))
