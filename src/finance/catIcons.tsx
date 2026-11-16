import {
  Apple,
  Award,
  Baby,
  Banknote,
  Bath,
  Bed,
  Beer,
  Bike,
  BookOpen,
  Briefcase,
  Building2,
  Bus,
  Cake,
  Calculator,
  Camera,
  Car,
  CarTaxiFront,
  Church,
  Coffee,
  Coins,
  CreditCard,
  Droplets,
  Dumbbell,
  Film,
  Flame,
  Flower2,
  Fuel,
  Gamepad2,
  Gem,
  Gift,
  Glasses,
  Globe,
  GraduationCap,
  HandCoins,
  HandHeart,
  Headphones,
  Heart,
  HeartPulse,
  Hotel,
  House,
  Key,
  Landmark,
  Laptop,
  Lightbulb,
  Mountain,
  Music,
  Package,
  Palette,
  PawPrint,
  Percent,
  PiggyBank,
  Pill,
  Pizza,
  Plane,
  Popcorn,
  Receipt,
  Scissors,
  Shapes,
  ShieldCheck,
  Shirt,
  ShoppingBag,
  ShoppingCart,
  Smartphone,
  Sofa,
  Sparkles,
  Sprout,
  Stethoscope,
  Store,
  Tag,
  Target,
  Ticket,
  TrendingUp,
  Truck,
  Tv,
  Umbrella,
  Undo2,
  Users,
  Utensils,
  Wallet,
  Wifi,
  Wine,
  Wrench,
  Zap,
  Laugh,
  Smile,
  Meh,
  Annoyed,
  Frown,
  type LucideIcon,
} from 'lucide-react';
import { catColor } from './charts';
import type { WorthTone } from './money';
import { settingsOf, useFinance } from './store';

/** Las caras de «¿Valió la pena?», de la mejor a la peor. */
export const worthIcons: Record<WorthTone, LucideIcon> = {
  great: Laugh,
  good: Smile,
  meh: Meh,
  doubt: Annoyed,
  bad: Frown,
};

/** Íconos para las categorías: clave → ícono y nombre (para buscar y para el tooltip). */
export const catIconSet: Record<string, { icon: LucideIcon; label: string }> = {
  comida: { icon: Utensils, label: 'Comida' },
  cafe: { icon: Coffee, label: 'Café' },
  pizza: { icon: Pizza, label: 'Comida rápida' },
  fruta: { icon: Apple, label: 'Mercado' },
  mercado: { icon: ShoppingCart, label: 'Carrito' },
  cerveza: { icon: Beer, label: 'Cerveza' },
  vino: { icon: Wine, label: 'Vino' },
  torta: { icon: Cake, label: 'Celebración' },
  carro: { icon: Car, label: 'Carro' },
  taxi: { icon: CarTaxiFront, label: 'Taxi' },
  bus: { icon: Bus, label: 'Bus' },
  bici: { icon: Bike, label: 'Bicicleta' },
  gasolina: { icon: Fuel, label: 'Gasolina' },
  avion: { icon: Plane, label: 'Viaje' },
  hotel: { icon: Hotel, label: 'Hotel' },
  paseo: { icon: Mountain, label: 'Paseo' },
  casa: { icon: House, label: 'Casa' },
  mueble: { icon: Sofa, label: 'Muebles' },
  cama: { icon: Bed, label: 'Descanso' },
  bano: { icon: Bath, label: 'Aseo' },
  luz: { icon: Zap, label: 'Energía' },
  agua: { icon: Droplets, label: 'Agua' },
  gas: { icon: Flame, label: 'Gas' },
  internet: { icon: Wifi, label: 'Internet' },
  celular: { icon: Smartphone, label: 'Celular' },
  llave: { icon: Key, label: 'Arriendo' },
  arreglo: { icon: Wrench, label: 'Arreglos' },
  idea: { icon: Lightbulb, label: 'Ideas' },
  salud: { icon: HeartPulse, label: 'Salud' },
  medico: { icon: Stethoscope, label: 'Médico' },
  pastilla: { icon: Pill, label: 'Medicamentos' },
  gafas: { icon: Glasses, label: 'Óptica' },
  gym: { icon: Dumbbell, label: 'Deporte' },
  belleza: { icon: Scissors, label: 'Belleza' },
  spa: { icon: Sparkles, label: 'Cuidado' },
  ocio: { icon: Popcorn, label: 'Ocio' },
  juego: { icon: Gamepad2, label: 'Juegos' },
  cine: { icon: Film, label: 'Cine' },
  tv: { icon: Tv, label: 'Streaming' },
  musica: { icon: Music, label: 'Música' },
  audio: { icon: Headphones, label: 'Audio' },
  boleta: { icon: Ticket, label: 'Eventos' },
  foto: { icon: Camera, label: 'Fotografía' },
  arte: { icon: Palette, label: 'Arte' },
  estudio: { icon: GraduationCap, label: 'Estudio' },
  libro: { icon: BookOpen, label: 'Libros' },
  trabajo: { icon: Briefcase, label: 'Trabajo' },
  laptop: { icon: Laptop, label: 'Tecnología' },
  oficina: { icon: Building2, label: 'Oficina' },
  compras: { icon: ShoppingBag, label: 'Compras' },
  ropa: { icon: Shirt, label: 'Ropa' },
  joya: { icon: Gem, label: 'Lujos' },
  paquete: { icon: Package, label: 'Pedidos' },
  envio: { icon: Truck, label: 'Envíos' },
  regalo: { icon: Gift, label: 'Regalos' },
  amor: { icon: Heart, label: 'Pareja' },
  familia: { icon: Users, label: 'Familia' },
  bebe: { icon: Baby, label: 'Bebé' },
  mascota: { icon: PawPrint, label: 'Mascotas' },
  planta: { icon: Sprout, label: 'Plantas' },
  flor: { icon: Flower2, label: 'Flores' },
  donacion: { icon: HandHeart, label: 'Donaciones' },
  iglesia: { icon: Church, label: 'Diezmo' },
  impuesto: { icon: Landmark, label: 'Impuestos' },
  factura: { icon: Receipt, label: 'Facturas' },
  cuentas: { icon: Calculator, label: 'Cuentas' },
  tarjeta: { icon: CreditCard, label: 'Tarjeta' },
  interes: { icon: Percent, label: 'Intereses' },
  seguro: { icon: Umbrella, label: 'Seguros' },
  escudo: { icon: ShieldCheck, label: 'Emergencias' },
  ahorro: { icon: PiggyBank, label: 'Ahorro' },
  meta: { icon: Target, label: 'Meta' },
  billete: { icon: Banknote, label: 'Sueldo' },
  monedas: { icon: Coins, label: 'Monedas' },
  billetera: { icon: Wallet, label: 'Billetera' },
  tienda: { icon: Store, label: 'Ventas' },
  honorarios: { icon: HandCoins, label: 'Honorarios' },
  premio: { icon: Award, label: 'Premios' },
  inversion: { icon: TrendingUp, label: 'Inversión' },
  reembolso: { icon: Undo2, label: 'Reembolso' },
  mundo: { icon: Globe, label: 'Internacional' },
  otro: { icon: Shapes, label: 'Otro' },
  etiqueta: { icon: Tag, label: 'Etiqueta' },
};

/** El ícono de cada categoría de Nexo (si no le eliges otro en Ajustes). */
const defaults: Record<string, string> = {
  Comida: 'comida',
  Transporte: 'carro',
  Hogar: 'casa',
  Salud: 'salud',
  Ocio: 'ocio',
  Educación: 'estudio',
  Trabajo: 'trabajo',
  Compras: 'compras',
  Regalos: 'regalo',
  Impuestos: 'impuesto',
  Ahorro: 'ahorro',
  Otro: 'otro',
  Salario: 'billete',
  Ventas: 'tienda',
  Honorarios: 'honorarios',
  Regalo: 'regalo',
  Reembolso: 'reembolso',
  Inversión: 'inversion',
  Emergencias: 'escudo',
  Meta: 'meta',
};

/** La clave del ícono de una categoría: la que elegiste, la de Nexo o una etiqueta. */
export const catIconKey = (name: string, chosen?: Record<string, string>) => {
  const k = chosen?.[name];
  return k && catIconSet[k] ? k : (defaults[name] ?? 'etiqueta');
};
export const isDefaultIcon = (name: string, key: string) => (defaults[name] ?? 'etiqueta') === key;

/** El ícono de una categoría, con los que elegiste en Ajustes. */
export function useCatIcons() {
  const fin = useFinance();
  const chosen = settingsOf(fin.items).catIcons;
  return (name: string) => catIconSet[catIconKey(name, chosen)].icon;
}

/** Ícono de una categoría dentro de un círculo de su color (`plain`: solo el ícono). */
export function CatIcon({
  name,
  size = 15,
  plain = false,
  iconKey,
}: {
  name: string;
  size?: number;
  plain?: boolean;
  /** Para mostrar un ícono concreto (la vista previa en Ajustes). */
  iconKey?: string;
}) {
  const iconOf = useCatIcons();
  const Icon = iconKey && catIconSet[iconKey] ? catIconSet[iconKey].icon : iconOf(name);
  if (plain) return <Icon size={size} aria-hidden="true" />;
  const c = catColor(name);
  const box = Math.round(size * 1.9);
  return (
    <span
      className="fz-cat-ico"
      aria-hidden="true"
      style={{
        width: box,
        height: box,
        color: c,
        background: `color-mix(in srgb, ${c} 13%, #fff)`,
      }}
    >
      <Icon size={size} />
    </span>
  );
}
