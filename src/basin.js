// One navigable and editable volume for the player, platforms, and encounters.
export const basin = {west:-256,east:256,north:-256,south:128,low:0.4,high:48};
export function insideBasin([x,y,z]){
  return x>=basin.west && x<=basin.east && y>=basin.low && y<=basin.high && z>=basin.north && z<=basin.south;
}
