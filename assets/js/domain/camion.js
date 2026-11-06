// Disposición de ruedas por tipo de vehículo (datos puros). Clave: cantidad de ruedas ('10' | '16').
export const MED_CFG={
  '10':[
    {positions:[{pos:1,side:'L'},{pos:2,side:'R'}],single:true},
    {positions:[{pos:3,side:'LL'},{pos:4,side:'LR'},{pos:5,side:'RL'},{pos:6,side:'RR'}],single:false},
    {positions:[{pos:7,side:'LL'},{pos:8,side:'LR'},{pos:9,side:'RL'},{pos:10,side:'RR'}],single:false},
  ],
  '16':[
    {positions:[{pos:1,side:'L'},{pos:2,side:'R'}],single:true},
    {positions:[{pos:3,side:'LL'},{pos:4,side:'LR'},{pos:5,side:'RL'},{pos:6,side:'RR'}],single:false},
    {positions:[{pos:7,side:'LL'},{pos:8,side:'LR'},{pos:9,side:'RL'},{pos:10,side:'RR'}],single:false},
    {positions:[{pos:11,side:'LL'},{pos:12,side:'LR'},{pos:13,side:'RL'},{pos:14,side:'RR'}],single:false},
    {positions:[{pos:15,side:'L'},{pos:16,side:'R'}],single:true},
  ],
};
