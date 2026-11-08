import { supabase } from '../backend';
import { parseGreeting, parseWeather, type Greeting, type Weather } from './greeting';

/**
 * Pide el saludo a la función `greeting`. Cualquier fallo (no desplegada, sin conexión, límite,
 * respuesta rara) lanza un error: la app se queda con el saludo de respaldo.
 */
export async function askGreeting(
  body: Record<string, unknown>,
): Promise<{ greeting: Greeting; weather: Weather | null }> {
  const { data, error } = await supabase.functions.invoke('greeting', { body, timeout: 15000 });
  if (error) throw new Error(error.message);
  const out = (data ?? {}) as { greeting?: unknown; weather?: unknown };
  const greeting = parseGreeting(out.greeting);
  if (!greeting) throw new Error('La función no devolvió un saludo válido.');
  return { greeting, weather: parseWeather(out.weather) };
}
