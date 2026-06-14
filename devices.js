export async function getDevices(){

await navigator.mediaDevices.getUserMedia({
video:true,
audio:true
});

const devices =
await navigator.mediaDevices.enumerateDevices();

return {

cameras:
devices.filter(
d=>d.kind==="videoinput"
),

microphones:
devices.filter(
d=>d.kind==="audioinput"
)

};

}
