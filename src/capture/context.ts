import type { MyProfile, Workspace } from '../data';
import { genderOf } from '../lib/gender';
import { selfContext } from '../lib/myself';
import { ME, kinCall, tiesOf } from '../lib/relations';
import { todayInputValue } from '../lib/format';

/** «tu mamá», «tu jefe»… de cada persona vinculada contigo. */
export function myKinOf(ws: Workspace) {
  const byId = new Map(ws.people.map((p) => [p.id, p]));
  return new Map(
    tiesOf(ME, ws.ties)
      .filter((v) => v.other !== ME && byId.has(v.other))
      .map((v) => [v.other, `tu ${kinCall(v.kind, genderOf(byId.get(v.other)))}`]),
  );
}

/** Lo que la IA necesita para proponer las piezas de un texto: tu gente, tus lugares y tú. */
export function captureContext(ws: Workspace, me: MyProfile, kin = myKinOf(ws)) {
  return {
    today: todayInputValue(),
    people: ws.people.slice(0, 400).map((p) => ({
      id: p.id,
      name: p.name,
      ...(p.profile.alias && { alias: p.profile.alias }),
      // Para que entienda «mi mamá», «mi tío»…: lo que es para ti.
      ...(kin.get(p.id) && { kin: kin.get(p.id) }),
    })),
    places: ws.places.slice(0, 200).map((p) => ({ id: p.id, name: p.name })),
    me: selfContext(me, ws.places),
  };
}
