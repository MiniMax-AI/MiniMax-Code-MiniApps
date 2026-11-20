"""Compute only supplied, comparable store metrics. Input JSON path; output JSON to stdout."""
import json,sys
from decimal import Decimal,InvalidOperation,ROUND_HALF_UP

def number(v):
    if isinstance(v,bool): raise ValueError('boolean is not an amount')
    try: n=Decimal(str(v))
    except InvalidOperation: raise ValueError('invalid amount')
    if not n.is_finite():raise ValueError('non-finite amount')
    return n

def amount(n):return str(n.quantize(Decimal('0.01'),rounding=ROUND_HALF_UP))
def percent(n,d):return None if d==0 else amount(n/d*100)
def calculate(data):
    stores=data['stores']
    if not stores:raise ValueError('stores cannot be empty')
    names=[x['name'] for x in stores]
    if len(names)!=len(set(names)):raise ValueError('duplicate store name')
    values=[number(x['sales']) for x in stores]
    total=sum(values,Decimal(0))
    out={'period':data['period'],'currency':data['currency'],'unit':data['unit'],'sales':amount(total),'store_count':len(stores),'warnings':[]}
    for key in ['target','previous_sales','year_ago_sales']:
        supplied=[key in x and x[key] is not None for x in stores]
        if any(supplied) and not all(supplied):out['warnings'].append(key+': partially missing, aggregate unavailable')
        aggregate=sum((number(x[key]) for x in stores),Decimal(0)) if all(supplied) else None
        out[key]=None if aggregate is None else amount(aggregate)
        if key=='target':out['attainment_pct']=None if aggregate is None else percent(total,aggregate)
        elif key=='previous_sales':out['mom_pct']=None if aggregate is None else percent(total-aggregate,aggregate)
        else:out['yoy_pct']=None if aggregate is None else percent(total-aggregate,aggregate)
    out['ranking']=[{'name':n,'sales':amount(v)} for n,v in sorted(zip(names,values),key=lambda pair:pair[1],reverse=True)]
    out['reconciliation']={}
    for key in ['daily_sales','category_sales']:
        if key not in data:continue
        other=sum((number(x) for x in data[key]),Decimal(0));diff=other-total
        out['reconciliation'][key]={'sum':amount(other),'difference':amount(diff),'matches':diff==0}
        if diff:out['warnings'].append(key+': does not reconcile with stores')
    return out

if __name__=='__main__':
    try:
        with open(sys.argv[1],encoding='utf-8') as f:data=json.load(f)
        print(json.dumps(calculate(data),ensure_ascii=False,indent=2))
    except (KeyError,ValueError,TypeError,IndexError) as e:
        print('Invalid input: '+str(e),file=sys.stderr);sys.exit(2)
