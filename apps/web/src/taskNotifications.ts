import { Capacitor } from '@capacitor/core';
/** User-consented notifications for tasks that finish while the app is running.
 * Remote/background push requires a separately authenticated task service.
 */
export async function requestTaskNotificationPermission():Promise<boolean>{
  if(Capacitor.isNativePlatform()){
    const { LocalNotifications }=await import('@capacitor/local-notifications');
    const result=await LocalNotifications.requestPermissions();
    if(result.display!=='granted')throw new Error('No se concedió permiso para avisos del teléfono');
    return true;
  }
  if(!('Notification' in window))throw new Error('Las notificaciones no están disponibles en este navegador');
  const permission = Notification.permission === 'granted'?'granted':await Notification.requestPermission();
  if(permission!=='granted')throw new Error('No se concedió permiso para notificaciones');
  return true;
}
export async function taskFinishedNotification(projectId:string,title:string,message:string):Promise<void>{
  if(Capacitor.isNativePlatform()){
    const { LocalNotifications }=await import('@capacitor/local-notifications');
    await LocalNotifications.schedule({notifications:[{
      id:Math.max(1,Math.floor(Date.now()%2100000000)),
      title,body:message.slice(0,240),extra:{projectId}
    }]});
    return;
  }
  if(!('Notification' in window)||Notification.permission!=='granted')return;
  const options:NotificationOptions={
    body:message.slice(0,240),
    tag:'alicelabs-task-'+projectId,
    icon:'/icon-192.png'
  };
  // Android installed PWAs prefer notifications issued by the service worker.
  if('serviceWorker' in navigator){
    try{
      const registration=await navigator.serviceWorker.ready;
      await registration.showNotification(title,options);
      return;
    }catch{/* regular notifications fallback on supported desktop browsers */}
  }
  try{new Notification(title,options);}catch{/* some browsers disallow regular notifications */}
}
