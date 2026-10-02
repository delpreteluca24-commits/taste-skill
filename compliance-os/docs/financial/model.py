def run(name, arpu, churn, cac, fixed, var_pct, new_by_month, months=24, extra_fixed_from=None):
    rows=[]; cust=0.0; cum=0.0
    for m in range(1,months+1):
        new=new_by_month[m-1] if m-1 < len(new_by_month) else new_by_month[-1]
        churned=cust*churn
        cust=cust-churned+new
        mrr=cust*arpu
        fx=fixed + (extra_fixed_from[1] if extra_fixed_from and m>=extra_fixed_from[0] else 0)
        cost=fx + new*cac + mrr*var_pct
        pl=mrr-cost; cum+=pl
        rows.append((m,new,round(cust,1),round(churned,1),round(mrr),round(cost),round(pl),round(cum)))
    return rows
def table(rows):
    s="| Mese | Nuovi | Clienti tot | Churn (n) | MRR € | Costi € | P/L € | Cum € |\n|---|---|---|---|---|---|---|---|\n"
    for r in rows: s+="| "+" | ".join(str(x) for x in r)+" |\n"
    return s
S={}
# Business 1: compliance subappaltatori. ARPU 199
S['B1']={
 'cons': dict(arpu=179,churn=0.04,cac=350,fixed=550,var_pct=0.08,new_by_month=[0,1,2,2,3,3,4,4,4,5,5,5]+[5]*12),
 'base': dict(arpu=199,churn=0.03,cac=300,fixed=550,var_pct=0.08,new_by_month=[0,1,2,3,4,4,5,5,6,6,6,6]+[6]*12, extra_fixed_from=(13,1200)),
 'aggr': dict(arpu=249,churn=0.02,cac=200,fixed=550,var_pct=0.08,new_by_month=[1,2,4,5,6,8,8,10,10,10,10,10]+[10]*12, extra_fixed_from=(10,1800)),
}
# Business 2: post-vendita fotovoltaico. ARPU 149
S['B2']={
 'cons': dict(arpu=129,churn=0.045,cac=400,fixed=600,var_pct=0.10,new_by_month=[0,1,1,2,2,3,3,3,4,4,4,4]+[4]*12),
 'base': dict(arpu=149,churn=0.035,cac=300,fixed=600,var_pct=0.10,new_by_month=[0,1,2,2,3,4,4,5,5,5,5,5]+[5]*12, extra_fixed_from=(13,1200)),
 'aggr': dict(arpu=199,churn=0.025,cac=250,fixed=600,var_pct=0.10,new_by_month=[0,2,3,4,6,6,8,8,8,8,8,8]+[8]*12, extra_fixed_from=(12,1800)),
}
# Business 3: raccolta documenti studi commercialisti. ARPU 129
S['B3']={
 'cons': dict(arpu=99,churn=0.05,cac=450,fixed=600,var_pct=0.12,new_by_month=[0,1,1,2,2,2,3,3,3,4,4,4]+[4]*12),
 'base': dict(arpu=129,churn=0.04,cac=350,fixed=600,var_pct=0.12,new_by_month=[0,1,2,2,3,4,4,5,5,5,5,5]+[5]*12, extra_fixed_from=(13,1200)),
 'aggr': dict(arpu=169,churn=0.03,cac=280,fixed=600,var_pct=0.12,new_by_month=[0,2,3,4,6,6,8,8,8,8,8,8]+[8]*12, extra_fixed_from=(12,1800)),
}
out=""
for b in S:
    for sc in S[b]:
        p=S[b][sc]; rows=run(b,**p)
        out+=f"\n### {b} – scenario {sc.upper()} (ARPU €{p['arpu']}, churn {p['churn']*100:.1f}%/mese, CAC €{p['cac']}, fissi €{p['fixed']}/mese)\n\n"
        out+="**Mesi 1–12**\n\n"+table(rows[:12])
        r12=rows[11]; r24=rows[23]
        out+=f"\n**Mese 24:** clienti {r24[2]}, MRR €{r24[4]}, ARR €{r24[4]*12}, costi €{r24[5]}/mese, P/L €{r24[6]}/mese, cumulato €{r24[7]}\n"
        # unit economics
        gm=1-p['var_pct']; lt=1/p['churn']; ltv=p['arpu']*gm*lt; 
        out+=f"\nUnit economics: GM {gm*100:.0f}% · lifetime {lt:.1f} mesi · LTV €{ltv:.0f} · LTV/CAC {ltv/p['cac']:.1f} · payback {p['cac']/(p['arpu']*gm):.1f} mesi · break-even clienti {p['fixed']/(p['arpu']*gm):.1f}\n"
open('model-output.md','w').write(out)
print(out[:3000])
