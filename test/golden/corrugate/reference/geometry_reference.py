# Independent transcription of the legacy corrugate geometry, used to derive the unit vectors of
# src/modules/pricing/calculators/corrugate/geometry.spec.ts (U-B6 slice 3). It follows the PHP layout —
# legacy pattern ids and sub ids, one function per PHP method — so it is checked against the PHP line by
# line, independently of the TypeScript port. Sources (legacy root /Users/superball/Abbon/Loco_Pack/locopack-web):
#   app/Models/CalculatorCorrugate.php  calculate:297-481, cal1-cal29:1580-1756, Tele*:1758-1784,
#   calculate_percent_from_pattern_area:1798-1810, top:1812, side:1846, top_side:1898, allArea:1938,
#   getConditionValue:2039.
# Python floats are IEEE doubles like PHP's. Regenerate: python3 geometry_reference.py > geometry.vectors.json && pnpm prettier --write geometry.vectors.json
import math, json
def cond(bands, v):
    for lo,hi,val in bands:
        if lo <= v <= hi: return val
    raise Exception('band')
def calc(pt, sub, W, L, D, ft, bands, plus=None):
    a,c,dd,g,fh,ct,z = ft['a'],ft['c'],ft['dd'],ft['g'],ft['fh'],ft['ct'],ft['z']
    i = cond(bands['i'], W) if 'i' in bands else 0
    j = cond(bands['j'], W/L) if 'j' in bands else 0
    k = cond(bands['k'], W) if 'k' in bands else 0
    m = cond(bands['m'], W) if 'm' in bands else 0
    Flap=SLH=ODL=ODW=ODH=None
    if pt==19:
        dW=((math.floor(W/2))*2)+(2*c)+D+dd; dL=g+((L+a)*2)+((W+a)*2)-3
        Flap=(math.floor(W/2))+c; SLH=D+dd; ODL=L+(2*fh); ODW=W+(2*fh); ODH=D+(4*fh)
    if pt==20:
        dW=D+W+(D+a)+(W+c+(2*fh))+(D+a)+(fh+a)+(D+a-2)+(fh+1+z); dL=(D*2)+(c*2)+L+a
        ODL=L+(2*fh); ODW=W+(4*fh); ODH=D+(2*fh)
    if pt==21:
        dW=(D+c+fh+(2.5*z))+((2*fh)+a-2+z)+(D+a+1)+(L+(6*fh)+a-1+(4*z))+(D+a+1)+((2*fh)+a-2+z)+(D+c+fh+(2.5*z))
        dL=(D+c+fh+(1.5*z))+(W+fh+a+1+(0.5*z))+(D+a+1)+(W+a+1)+(D+a-1)
        ODL=L+(8*fh); ODW=W+(2*fh); ODH=D+(2*fh)
    if pt==22:
        dW=(D+c+fh+(2.5*z))+((2*fh)+a-2+z)+(D+a+1)+(L+(6*fh)+a-1+(4*z))+(D+a+1)+((2*fh)+a-2+z)+(D+c+fh+(2.5*z))
        dL=(D+c+fh+(1.5*z))+(W+fh+a+1+(0.5*z))+(D+a+1)+(W+a+1)+(D+a-1)+(W-fh)
        ODL=L+(8*fh); ODW=W+(2*fh); ODH=D+(3*fh)
    if pt==23:
        dW=(D+c+fh+(2.5*z))+((2*fh)+a-2+z)+(D+a+1)+(L+(6*fh)+a-1+(4*z))+(D+a+1)+((2*fh)+a-2+z)+(D+c+fh+(2.5*z))
        dL=(D+c+fh+(1.5*z))+(W+(2*fh)+a+1+(0.5*z))+(D+a+1)+(W+a+fh+1)+(D+a-1)+(D-fh)
        ODL=L+(8*fh); ODW=W+(3*fh); ODH=D+(2*fh)
    if pt==24:
        dW=W; dL=L
    if pt==25:
        dW=D+W+(D+a)+(W+c+(2*fh))+(D+a)+(fh+a)+(D+a-2)+(fh+1+z); dL=(D*2)+(c*2)+L+a
        ODL=L+(4*fh)+5; ODW=W+(4*fh)+c; ODH=D+(2*fh)
    elif pt==26:
        dW=i+W+a+(D+a)+((W/2)+c-1)+(((W*3)/16)*m)+k+(((L/9)-(((W/2)+c-1)+(((W*3)/16)*m)+k-(L/3)))*j)
        dL=g+(L+a)+(W+a)+(L+a)+(W+a-3); ODL=L+(2*fh); ODW=W+(2*fh); ODH=D+(3*fh)
    elif pt==27:
        dW=25+30+(W/2)+(D+a)+((W/2)+c-1)+(((W*3)/16)*m)+k+(((L/9)-(((W/2)+c-1)+(((W*3)/16)*m)+k-(L/3)))*j)
        dL=g+(L+a)+(W+a)+(L+a)+(W+a-3); ODL=L+(2*fh); ODW=W+(2*fh); ODH=D+(2*fh)+25+30
    elif pt==28:
        dW=25+30+(20+a)+(W/2)+(D+a)+((W/2)+c-1)+(((W*3)/16)*m)+k+(((L/9)-(((W/2)+c-1)+(((W*3)/16)*m)+k-(L/3)))*j)
        dL=g+(L+a)+(W+a)+(L+a)+(W+a-3); ODL=L+(2*fh); ODW=W+(2*fh); ODH=D+(2*fh)+25+30+(20+a)
    elif pt==29:
        if sub==2:
            W=W+(2*fh)-ct; L=L+(2*fh)-ct; D=D+(2*fh)-ct
        dW=(W/2)+c+D+a; dL=g+((L+a)*2)+((W+a)*2)-3; Flap=(W/2)+c; SLH=D+a
        ODL=L+(2*fh); ODW=W+(2*fh); ODH=D+(2*fh)
    elif pt==30:
        if sub==3:
            dW=fh+(D-c)+(fh+a)+D+(((2*fh)+c)*2)+L+D+(fh+a)+(D-c)+fh; dL=D+(W+a)+D
            ODL=L+(6*fh); ODW=W+(2*fh); ODH=D+fh
        elif sub==4:
            dw_,dl_,dd_=W,L,D
            W=dd_+fh; L=dw_+(2*fh); D=dl_+(6*fh)
            dW=g+(L+a+1)+(W+a+1)+(L+a+1)+(W+a-1); dL=D; ODL=D; ODW=L+(2*fh)+1; ODH=W+(2*fh)+1
    elif pt==38:
        dW=fh+(D-c)+(fh+a)+D+(((2*fh)+c)*2)+L+D+(fh+a)+(D-c)+fh; dL=D+(W+a)+D
        ODL=L+(6*fh); ODW=W+(2*fh); ODH=D+fh
    elif pt==39:
        dW=(W*2)+(2*c)+D+dd; dL=g+((L+a)*2)+((W+a)*2)-3; Flap=W+c; SLH=D+dd
        ODL=L+(2*fh); ODW=W+(2*fh); ODH=D+(6*fh)
    pdl=pdw=0
    if plus:
        pdl,pdw=plus['dl'],plus['dw']; dW+=pdw; dL+=pdl
    return dict(W=W,L=L,D=D,dW=dW,dL=dL,Flap=Flap,SLH=SLH,ODL=ODL,ODW=ODW,ODH=ODH,area_raw=dL*dW/1000000,i=i,j=j)

def top(d,pt,sub):
    W,L,D,a,c,fh=d['W'],d['L'],d['D'],d['a'],d['c'],d['fh']
    if pt==19: return (((W/2)+c) * (((L+a)*2)+((W+a)*2)-3))/1000000
    if pt==20: return ((L+a) * W ) /1000000
    if pt==21: return ((L+a) * (W+fh+a+1))/1000000
    if pt==22: return (((L+a) * (W+fh+a+1))+((W-fh)*L))/1000000
    if pt==23: return ((L+a) * (W+fh+a+1))/1000000
    if pt==24: return (d['dL']*d['dW'])/1000000
    if pt==25: return ((L+a) * W+a ) /1000000
    if pt==26: return ((d['i']+W)*(L+a+c+c))/1000000
    if pt==27: return ((25+30+(W/2))*((L+a)+(W+a)+(L+a)+(W+a-3)))/1000000
    if pt==28: return ((25+30+(20+a)+(W/2))*((L+a)+(W+a)+(L+a)+(W+a-3)))/1000000
    if pt==29: return (((W/2)+c) * (((L+a)*2)+((W+a)*2)-3))/1000000
    if pt==30:
        if sub==3: return 0
        if sub==4: return (D*(L+a))/1000000
    if pt==39: return ((W+c) * (((L+a)*2)+((W+a)*2)-3))/1000000
    return None
def side(d,pt,sub):
    W,L,D,a,c,dd,fh,t=d['W'],d['L'],d['D'],d['a'],d['c'],d['dd'],d['fh'],d['t']
    if pt in (19,39): return ((D+dd) *  (((L+a)*2)+((W+a)*2)-3))/1000000
    if pt==20 or pt==25:
        if t==1: return (((D*2)+(c*2)+L+a) * ((D+a)+(W+c+(2*fh))+(D+a)))/1000000
        if t==2: return ((((D+a) * (L+a))*2)+((D+c) * (W+c))*2)/1000000
        return None
    if pt==21:
        if t==1: return (((D+a)*(L+a))+(((D+a+1)+(L+(6*fh)+a-1)+(D+a+1))) * ((D+a+1)+(W+a+1)+(D+a-1)))/1000000
        if t==2: return ((((D+a)*(L+a))*3)+(((D+a+1)*(W+a+1))*2))/1000000
        return None
    if pt==22:
        if t==1: return (((D+c+fh+fh) * (L+(6*fh)+a-1)) + (((D+a+fh+1)+(W+a+1)+(D+a)) * ((D+a+1+fh)+(L+(6*fh)+a-1)+(D+a+1+fh))))/1000000
        if t==2: return ((((D+a)*(L+a))*3)+(((D+a+1)*(W+a+1))*2))/1000000
        return None
    if pt==23:
        if t==1: return (((D+a)*(L+a))+((((D+a+1)+(L+(6*fh)+a-1)+(D+a+1))) * ((D+a+1)+(L+(6*fh)+a-1)+(D+a+1))))/1000000
        if t==2: return ((((D+a)*(L+a))*3)+(((D+a+1)*(W+a+1))*2))/1000000
        return None
    if pt==24: return (d['dL']*d['dW'])/1000000
    if pt in (26,27,28): return ((D+a)*((L+a)+(W+a)+(L+a)+(W+a-3)))/1000000
    if pt==29: return ((D+a) * (((L+a)*2)+((W+a)*2)-3))/1000000
    if pt==30:
        if sub==3: return ((D+W+a+D)*((fh+a)+D+(((2*fh)+c)*2)+L+D+(fh+a)))/1000000
        if sub==4: return ((D*(W+a))*2)/1000000
    return None
def top_side(d,pt,sub,f4):
    W,L,D,a,c,fh,t=d['W'],d['L'],d['D'],d['a'],d['c'],d['fh'],d['t']
    if pt==24: return (d['dL']*d['dW'])/1000000
    if (not f4) or pt in (19,25,29,39):
        return (top(d,pt,sub) or 0)+(side(d,pt,sub) or 0)
    if pt==20:
        if t==1: return (((D*2)+(c*2)+L+a) * (W+(D+a)+(W+c+(2*fh))+(D+a)))/1000000
    elif pt==21:
        if t==1: return (((D+a+1)+(L+(6*fh)+a-1)+(D+a+1))) * ((D+c+fh)+(W+fh+a+1)+(D+a+1)+(W+a+1)+(D+a-1))/1000000
    elif pt==22:
        if t==1: return (((D+a+1+fh)+(L+(6*fh)+a-1)+(D+a+1+fh)) * ((D+c+fh+fh)+(W+fh+a+1)+(D+a+fh+1)+(W+a+1)+(D+a)+(W-fh)))/1000000
    elif pt==23:
        if t==1: return (((D+a+1)+(L+(6*fh)+a-1)+(D+a+1)) * ((D+c+fh)+(W+(2*fh)+a+1)+(D+a+1)+(W+a+fh+1)+(D+a-1)))/1000000
    elif pt==26: return ((d['i']+W+a+(D+a))*((L+a)+(W+a)+(L+a)+(W+a-3)))/1000000
    elif pt==27: return ((25+30+(W/2)+(D+a))*((L+a)+(W+a)+(L+a)+(W+a-3)))/1000000
    elif pt==28: return ((25+30+(20+a)+(W/2)+(D+a))*((L+a)+(W+a)+(L+a)+(W+a-3)))/1000000
    elif pt==30:
        if sub==3: return ((D+W+a+D)*((fh+a)+D+(((2*fh)+c)*2)+L+D+(fh+a)))/1000000
        if sub==4: return (((W+a)+(L+a)+(W+a-3))*D)/1000000
    return None
def all_area(d,pt,sub):
    W,L,D,a=d['W'],d['L'],d['D'],d['a']
    if pt in (19,39): return (d['dW'] * (((L+a)*2)+((W+a)*2)-3))/1000000
    if pt in (26,27,28): return (d['dW']*((L+a)+(W+a)+(L+a)+(W+a-3)))/1000000
    if pt==29: return (d['dW'] * (((L+a)*2)+((W+a)*2)-3))/1000000
    if pt==30:
        if sub==3: return (d['dL']*d['dW'])/1000000
        if sub==4: return (((L+a)+(W+a)+(L+a)+(W+a-3))*D)/1000000
    return (d['dL']*d['dW'])/1000000
def percent(r, ft, pt, sub, area, t, f4):
    d=dict(W=r['W'],L=r['L'],D=r['D'],dW=r['dW'],dL=r['dL'],a=ft['a'],c=ft['c'],dd=ft['dd'],fh=ft['fh'],i=r['i'],t=t)
    fn={36:lambda:top(d,pt,sub),37:lambda:side(d,pt,sub),38:lambda:top_side(d,pt,sub,f4),39:lambda:all_area(d,pt,sub)}[area]
    v=fn(); v=0 if v is None else v
    return (v/((r['dL']*r['dW'])/1000000))*100

B=dict(a=3,c=4,dd=5,g=35,fh=3,ct=2,z=0.5)
BC=dict(a=6,c=8,dd=10,g=40,fh=6,ct=4,z=1)
bands={'i':[(0,200,10),(200.0001,9999,15)],'j':[(0,0.5,1),(0.5001,10,0)],'k':[(0,9999,5)],'m':[(0,9999,1)]}
cases=[
 ('rsc',19,None,301,405,250,B,None),
 ('rsc',19,None,300,400,250,BC,{'dl':2,'dw':-1.5}),
 ('single_tuck',20,None,150,220,90,B,None),
 ('double_tuck',21,None,150,220,90,BC,None),
 ('double_tuck_top_wall',22,None,150,220,90,B,None),
 ('double_tuck_side_wall',23,None,150,220,90,B,{'dl':1,'dw':1}),
 ('flat_sheet',24,None,400,600,0,B,None),
 ('seafood',25,None,300,450,150,BC,None),
 ('open_top',26,None,180,400,120,B,None),
 ('open_top',26,None,250,400,120,B,None),
 ('handle',27,None,180,300,150,B,None),
 ('handle_rim',28,None,180,300,150,BC,None),
 ('tele_body',29,1,300,400,100,B,None),
 ('tele_lid',29,2,300,400,100,B,None),
 ('slide_tray',30,3,200,300,60,B,None),
 ('slide_sleeve',30,4,200,300,60,B,None),
 ('tray',38,None,200,300,60,BC,None),
 ('full_overlap',39,None,300,400,250,B,None),
]
out=[]
for name,pt,sub,W,L,D,ft,plus in cases:
    r=calc(pt,sub,W,L,D,ft,bands,plus)
    pct={}
    for area,key in ((36,'top'),(37,'side'),(38,'top_side'),(39,'all_round')):
        for t in (1,2):
            for f4 in (False,True):
                pct[f'{key}:{t}:{int(f4)}']=percent(r,ft,pt,sub,area,t,f4)
    out.append(dict(formula=name,w=W,l=L,d=D,flute='B' if ft is B else 'BC',plus=plus,
      expect=dict(w=r['W'],l=r['L'],d=r['D'],dw=r['dW'],dl=r['dL'],flap=r['Flap'],slh=r['SLH'],odl=r['ODL'],odw=r['ODW'],odh=r['ODH'],areaRaw=r['area_raw']),pct=pct))
print(json.dumps(out, indent=1))
