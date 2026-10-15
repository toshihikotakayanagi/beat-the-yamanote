// 自転車の種類・服の色・ヘルメットの色（区間選択の画面で選ぶ。見た目だけで、速さや記録は変わらない）
// 色は 0xRRGGBB。3D版は自転車のモデルの材質に、2D版は真上から見た形に使う

// 自転車の種類（3D版はモデルを入れ替える。2D版はかごの有無だけ）
export const BIKE_TYPES = [
  { id: 'road', name: 'ロード', basket: false },
  { id: 'city', name: 'ママチャリ', basket: true },
  { id: 'ebike', name: '電動アシスト', basket: true },
];

// 服（ジャージ・パンツ）とフレームの色。ゴーストの白と紛れないよう、白っぽい組み合わせは入れない
export const OUTFITS = [
  { id: 'yellow', name: '黄', jersey: 0xffcc33, shorts: 0x22324f, frame: 0xffcc33 },
  { id: 'red', name: '赤', jersey: 0xe8443a, shorts: 0x1b1d22, frame: 0xd8322a },
  { id: 'blue', name: '青', jersey: 0x3b82f0, shorts: 0x15171b, frame: 0x2f6fde },
  { id: 'green', name: '黄緑', jersey: 0x80c241, shorts: 0x2a2f3a, frame: 0x80c241 },
  { id: 'orange', name: 'オレンジ', jersey: 0xff8a1c, shorts: 0x2a2f3a, frame: 0xff8a1c },
  { id: 'pink', name: 'ピンク', jersey: 0xf48cbc, shorts: 0x3a2a4a, frame: 0xf06fa8 },
  { id: 'black', name: '黒', jersey: 0x2f3239, shorts: 0x1b1d22, frame: 0x2a2d33 },
];

// ヘルメットの色（ジャージの横の線とボトルも同じ色）
export const HELMETS = [
  { id: 'red', name: '赤', color: 0xe8443a },
  { id: 'white', name: '白', color: 0xf4f4f4 },
  { id: 'black', name: '黒', color: 0x22252b },
  { id: 'blue', name: '青', color: 0x2f6fde },
  { id: 'yellow', name: '黄', color: 0xffcc33 },
  { id: 'green', name: '黄緑', color: 0x80c241 },
  { id: 'pink', name: 'ピンク', color: 0xf48cbc },
];

const find = (list, id) => list.find((x) => x.id === id) ?? list[0];

// 選んだ組み合わせの自転車の色（3D版の makeBike に渡す形）
export function riderColors(outfitId, helmetId) {
  const o = find(OUTFITS, outfitId), h = find(HELMETS, helmetId);
  return { frame: o.frame, jersey: o.jersey, shorts: o.shorts, helmet: h.color };
}

export const bikeTypeOf = (id) => find(BIKE_TYPES, id);
export const outfitOf = (id) => find(OUTFITS, id);
export const helmetOf = (id) => find(HELMETS, id);
