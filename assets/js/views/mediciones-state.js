// Estado compartido de la vista Mediciones (modo vehículo y modo dispositivo).
export const med={
  tireData:{},      // posición -> historial ascendente (máx. 10)
  vehs:[],          // vehículos del cliente seleccionado
  selPos:null,      // posición seleccionada
  tipoRuedas:'10',  // '10' | '16'
  mode:'vehiculo',  // 'vehiculo' | 'dispositivo'
  allDevices:[], selDevice:null, deviceSessions:[], selSession:null
};
