# Генератор ригів і частин бестіарію: python3 -I tools/gen_bestiary.py "$PWD"
# Переписує блоки ворогів lane у data/parts.json і data/rigs.json; координати
# частин рахуються від коробки тіла, тож ноги, руки й накладки не роз'їжджаються.
import json, re, sys
ROOT = sys.argv[1]
P = ROOT + '/data/parts.json'; R = ROOT + '/data/rigs.json'; E = ROOT + '/data/laneEnemies.json'

def compact(v):
    t = json.dumps(v, ensure_ascii=False, separators=(', ', ': '))
    t = re.sub(r'\{(?=")', '{ ', t); t = re.sub(r'(?<=[\d\]"e])\}', ' }', t)
    return t
def part_txt(p):
    head = {k: v for k, v in p.items() if k != 'mods'}
    first = ', '.join(f'"{k}": {compact(v)}' for k, v in head.items())
    if not p.get('mods'): return '      { ' + first + ' }'
    mods = ',\n'.join('          ' + compact(m) for m in p['mods'])
    return '      {\n        ' + first + ',\n        "mods": [\n' + mods + '\n        ]\n      }'
def rig_txt(name, r):
    out = [f'  "{name}": {{', f'    "_": {json.dumps(r["_"], ensure_ascii=False)},',
           f'    "hitbox": {compact(r["hitbox"])},', f'    "anchors": {compact(r["anchors"])},', '    "parts": [',
           ',\n'.join(part_txt(p) for p in r['parts']), '    ]', '  }']
    return '\n'.join(out)

r3 = lambda v: round(v, 3)
def walk(amp, f, ph): return {"type": "bob", "amp": r3(amp), "freq": f, "on": "walk", "phase": ph}
def sway(amp, f, ph=0, on=None):
    m = {"type": "sway", "amp": amp, "freq": f, "phase": ph}
    if on: m["on"] = on
    return m

PARTS = {}   # id -> (gen, size, line)
RIGS = {}    # name -> rig

class C:
    """Істота: тіло з півотом унизу по центру; решта частин — від нього в частках коробки тіла."""
    def __init__(s, rid, note, body_gen, size, line, ground, bottom, hitbox, k=1.0):
        s.rid, s.k = rid, k
        s.bw, s.bh = size[0] * k, size[1] * k
        s.line = line * k
        s.prefix = rid
        # півот тіла внизу коробки; низ малюнка — частка bottom від висоти коробки
        s.bpos = [0, r3(ground * k + (1 - bottom) * s.bh)]
        s.parts = []
        s.note, s.hitbox = note, [r3(hitbox[0] * k), r3(hitbox[1] * k)]
        s.add_part('body', body_gen, size)
        s.body_index = None
    def add_part(s, name, gen, size):
        pid = f'{s.prefix}/{name}'
        PARTS[pid] = (gen, [r3(size[0] * s.k), r3(size[1] * s.k)], r3(s.line))
        return pid
    def rel(s, fx, fy):  # точка коробки тіла відносно суглоба тіла
        return [r3((fx - 0.5) * s.bw), r3((fy - 1.0) * s.bh)]
    def absol(s, fx, fy):
        x, y = s.rel(fx, fy)
        return [r3(s.bpos[0] + x), r3(s.bpos[1] + y)]

def build(c, before, body_mods, overlays, children, after):
    """before/after — частини без батька (ноги); overlays — накладки на тіло; children — руки, крила, хвости."""
    parts = []
    for p in before: parts.append(p)
    bi = len(parts)
    parts.append({"part": f"{c.prefix}/body", "pos": c.bpos, "pivot": [0.5, 1.0], "pen": "red", "mods": body_mods})
    for name, gen, pen in overlays:
        pid = c.add_part(name, gen, [c.bw / c.k, c.bh / c.k])
        parts.append({"part": pid, "parent": bi, "pos": [0, 0], "pivot": [0.5, 1.0], "pen": pen})
    for ch in children:
        ch = dict(ch); ch["parent"] = bi; parts.append(ch)
    for p in after: parts.append(p)
    hb = c.hitbox
    RIGS[c.rid] = {"_": c.note, "hitbox": hb, "anchors": {"hit": [0, r3(-hb[1] * 0.5)], "ground": [0, r3(0.5 * c.k)]}, "parts": parts}

def feet(c, xs, fy, size=(0.34, 0.2), gen='m_foot', amp=0.07, f=2.2):
    """Ступні під тілом: верх ступні торкається низу тіла."""
    pid = c.add_part('foot', gen, list(size))
    fw, fh = size[0] * c.k, size[1] * c.k
    out = []
    for i, fx in enumerate(xs):
        x, y = c.absol(fx, fy)
        out.append({"part": pid, "pos": [x, r3(y + fh / 2)], "pivot": [0.5, 0.5], "pen": "red", "mods": [walk(-amp * c.k, f, 0.5 if i == 0 else 0)]})
    return out

# ============================ ЗВИЧАЙНІ ============================
def imp(k=1.0):
    c = C('imp', 'Вухань: яйце з довгими вухами, що ростуть із контуру назовні; великі очі-дірки, два ікла, ступні під тілом, лапка збоку.', 'imp_body', [1.2, 1.35], 0.05, 0.32, 0.97, [1.5, 1.5], k)
    arm = c.add_part('paw', 'm_paw', [0.48, 0.3])
    build(c, feet(c, [0.66], 0.97), [{"type": "squash", "amp": 0.04, "freq": 1.2}, walk(0.035, 4.4, 0), {"type": "recoil", "amp": 0.25, "dir": [-1, 0]}],
          [('pupils', 'imp_pupils', 'pencil')],
          [{"part": arm, "pos": c.rel(0.145, 0.72), "pivot": [0.97, 0.5], "rot": 12, "pen": "red", "mods": [sway(8, 0.9), {"type": "swing", "amp": -50}]}],
          feet(c, [0.34], 0.97))
def slime(k=1.0):
    c = C('slime', 'Клякса: крапля без кінцівок, пересувається стрибками-стисканнями; очі-дірки, хвилястий рот.', 'slime_body', [1.3, 1.25], 0.05, 0.42, 0.95, [1.5, 1.4], k)
    build(c, [], [{"type": "squash", "amp": 0.05, "freq": 1.1}, {"type": "squash", "amp": 0.12, "freq": 2.2, "on": "walk"}, walk(0.06, 2.2, 0.25), {"type": "recoil", "amp": 0.22, "dir": [-1, 0]}],
          [('pupils', 'slime_pupils', 'pencil')], [], [])
def cyclops(k=1.0):
    c = C('cyclops', 'Одноокий: куля з одним великим оком, вусики з кульками ростуть із контуру, зубастий рот.', 'cyc_body', [1.2, 1.35], 0.05, 0.32, 0.97, [1.5, 1.5], k)
    arm = c.add_part('paw', 'm_paw', [0.48, 0.3])
    build(c, feet(c, [0.66], 0.97), [{"type": "squash", "amp": 0.04, "freq": 1.0}, walk(0.035, 4.4, 0), {"type": "recoil", "amp": 0.25, "dir": [-1, 0]}],
          [('pupils', 'cyc_pupils', 'pencil')],
          [{"part": arm, "pos": c.rel(0.125, 0.72), "pivot": [0.97, 0.5], "rot": 12, "pen": "red", "mods": [sway(8, 0.9), {"type": "swing", "amp": -50}]}],
          feet(c, [0.34], 0.97))
def mushroom(k=1.0):
    c = C('mushroom', 'Грибник: капелюх у плямах сидить на ніжці (торкаються лінією), обличчя на ніжці, ступні під нею.', 'mush_body', [1.2, 1.45], 0.05, 0.32, 0.97, [1.5, 1.6], k)
    build(c, feet(c, [0.645], 0.97, (0.28, 0.18)), [{"type": "sway", "amp": 3, "freq": 0.6}, walk(0.035, 4.4, 0), {"type": "recoil", "amp": 0.22, "dir": [-1, 0]}],
          [('pupils', 'mush_pupils', 'pencil')], [], feet(c, [0.355], 0.97, (0.28, 0.18)))
def ghost(k=1.0):
    c = C('ghost', 'Привид: одне простирадло з ручками-обрубками й хвилястим подолом, ширяє над землею; темні очі, рот «О».', 'ghost_body', [1.2, 1.4], 0.05, 0.3, 0.95, [1.5, 1.6], k)
    build(c, [], [{"type": "bob", "amp": 0.07, "freq": 0.9}, sway(4, 0.7), {"type": "recoil", "amp": 0.25, "dir": [-1, 0]}],
          [('pupils', 'ghost_pupils', 'pencil')], [], [])

# ============================ ШВИДКІ ============================
def legs_children(c, gen_a, gen_b, f=5.0, amp=0.035):
    a = c.add_part('legs_a', gen_a, [c.bw / c.k, c.bh / c.k]); b = c.add_part('legs_b', gen_b, [c.bw / c.k, c.bh / c.k])
    return [{"part": a, "pos": [0, 0], "pivot": [0.5, 1.0], "pen": "red", "mods": [walk(-amp, f, 0), sway(3, f, 0, "walk")]},
            {"part": b, "pos": [0, 0], "pivot": [0.5, 1.0], "pen": "red", "mods": [walk(-amp, f, 0.5), sway(3, f, 0.5, "walk")]}]
def spider(k=1.0):
    c = C('spider', 'Павук: голова й черевце торкаються, шість лап починаються на контурі й ідуть лише назовні; дві трійки перебирають у протифазі.', 'spider_body', [1.8, 1.0], 0.042, 0.5, 0.99, [1.1, 1.1], k)
    build(c, [], [{"type": "squash", "amp": 0.04, "freq": 2.4}, walk(0.02, 10, 0), {"type": "recoil", "amp": 0.2, "dir": [-1, 0]}],
          [('pupils', 'spider_pupils', 'pencil')], legs_children(c, 'spider_legs_a', 'spider_legs_b'), [])
def bat(k=1.0):
    c = C('bat', 'Кажан: кругле тільце з вухами-виростами, крила кріпляться збоку на контурі й махають; летить над землею.', 'bat_body', [1.0, 1.0], 0.045, 0.15, 0.88, [1.2, 1.1], k)
    w = c.add_part('wing', 'bat_wing', [0.7, 0.65])
    build(c, [], [{"type": "bob", "amp": 0.08, "freq": 1.6}, {"type": "recoil", "amp": 0.2, "dir": [-1, 0]}],
          [('pupils', 'bat_pupils', 'pencil')],
          [{"part": w, "pos": c.rel(0.21, 0.55), "pivot": [0.97, 0.45], "pen": "red", "mods": [sway(22, 3.2, 0)]},
           {"part": w, "pos": c.rel(0.79, 0.55), "pivot": [0.97, 0.45], "flip": True, "pen": "red", "mods": [sway(22, 3.2, 0.5)]}], [])
def rat(k=1.0):
    c = C('rat', 'Щур: тіло, морда й вухо — вирости з контуру, хвіст кріпиться ззаду й хитається, лапки під черевом.', 'rat_body', [1.6, 0.9], 0.042, 0.5, 0.99, [1.1, 1.0], k)
    t = c.add_part('tail', 'rat_tail', [0.7, 0.42])
    ch = legs_children(c, 'rat_legs_a', 'rat_legs_b', 6.0, 0.03)
    ch.append({"part": t, "pos": c.rel(0.825, 0.6), "pivot": [0.03, 0.7], "pen": "red", "mods": [sway(12, 2.0)]})
    build(c, [], [{"type": "squash", "amp": 0.03, "freq": 2.4}, walk(0.02, 12, 0), {"type": "recoil", "amp": 0.2, "dir": [-1, 0]}],
          [('pupils', 'rat_pupils', 'pencil')], ch, [])
def beetle(k=1.0):
    c = C('beetle', 'Жук: панцир у плямах, голова торкається спереду, вусики ростуть із голови назовні, шість лапок під панцирем.', 'bug_body', [1.5, 1.0], 0.042, 0.5, 0.99, [1.1, 1.1], k)
    build(c, [], [{"type": "squash", "amp": 0.03, "freq": 2.0}, walk(0.02, 10, 0), {"type": "recoil", "amp": 0.2, "dir": [-1, 0]}],
          [('pupils', 'bug_pupils', 'pencil')], legs_children(c, 'bug_legs_a', 'bug_legs_b'), [])

# ============================ БРОНЬОВАНІ ============================
CROWNS = {}
def ogre(k=1.0, crown=False):
    rid = 'ogre_king' if crown else 'ogre'
    c = C(rid, ('Бос: ' if crown else '') + 'Огр у шоломі: шолом вирізаний із тіла й намальований олівцем (він і каже «броньований»), ріжки ростуть із шолома назовні, дубина збоку.', 'ogre_body', [1.6, 1.65], 0.055, 0.32, 0.97, [1.9, 1.9], k)
    cl = c.add_part('club', 'm_club', [1.0, 0.42])
    ch = [{"part": cl, "pos": c.rel(0.085, 0.68), "pivot": [0.97, 0.52], "rot": -25, "pen": "red", "mods": [sway(4, 0.5), {"type": "swing", "amp": -70}]}]
    ch += crown_parts(c, 0.5, 0.3, 0.42) if crown else []
    build(c, feet(c, [0.66], 0.97, (0.42, 0.24), amp=0.06, f=1.6), [{"type": "squash", "amp": 0.03, "freq": 0.6}, walk(0.03, 3.2, 0), {"type": "recoil", "amp": 0.3, "dir": [-1, 0]}],
          [('helmet', 'ogre_helmet', 'pencil'), ('pupils', 'ogre_pupils', 'pencil')], ch, feet(c, [0.34], 0.97, (0.42, 0.24), amp=0.06, f=1.6))
def knight(k=1.0, crown=False):
    rid = 'knight_king' if crown else 'knight'
    c = C(rid, ('Бос: ' if crown else '') + 'Лицар-відро: тулуб, відро-шолом олівцем стоїть на тулубі, у візорі жарини маркером, плюмаж росте з відра, щит торкається тулуба збоку.', 'knight_body', [1.4, 1.7], 0.05, 0.32, 0.94, [1.9, 1.9], k)
    sh = c.add_part('shield', 'm_shield', [0.55, 0.75])
    ch = [{"part": sh, "pos": c.rel(0.215, 0.72), "pivot": [0.97, 0.5], "pen": "pencil", "mods": [sway(3, 0.6), {"type": "recoil", "amp": 0.15, "dir": [-1, 0]}]}]
    ch += crown_parts(c, 0.5, 0.005, 0.36) if crown else []
    build(c, feet(c, [0.66], 0.94, (0.34, 0.2), amp=0.06, f=1.8), [walk(0.03, 3.6, 0), {"type": "recoil", "amp": 0.3, "dir": [-1, 0]}],
          [('helmet', 'knight_helmet', 'pencil'), ('glow', 'knight_glow', 'marker')], ch, feet(c, [0.34], 0.94, (0.34, 0.2), amp=0.06, f=1.8))
def turtle(k=1.0, crown=False):
    rid = 'turtle_king' if crown else 'turtle'
    c = C(rid, ('Бос: ' if crown else '') + 'Черепаха: панцир олівцем лежить на череві (торкаються лінією), голова окремо спереду, ступні під черевом.', 'turtle_body', [1.9, 1.3], 0.05, 0.32, 0.74, [1.9, 1.6], k)
    ch = crown_parts(c, 0.14, 0.395, 0.26) if crown else []
    build(c, feet(c, [0.78], 0.74, (0.36, 0.22), amp=0.05, f=1.6), [walk(0.025, 3.2, 0), sway(1.5, 0.4), {"type": "recoil", "amp": 0.25, "dir": [-1, 0]}],
          [('shell', 'turtle_shell', 'pencil'), ('pupils', 'turtle_pupils', 'pencil')], ch, feet(c, [0.42], 0.74, (0.36, 0.22), amp=0.05, f=1.6))
def golem(k=1.0, crown=False):
    rid = 'golem_king' if crown else 'golem'
    c = C(rid, ('Бос: ' if crown else '') + 'Голем: брили торкаються гранями (голова на тулубі, руки звисають із плечей убік), очі-жарини маркером.', 'golem_body', [1.7, 1.8], 0.055, 0.32, 0.92, [1.9, 2.0], k)
    arm = c.add_part('arm', 'golem_arm', [0.5, 0.8])
    ch = [{"part": arm, "pos": c.rel(0.215, 0.42), "pivot": [0.92, 0.06], "pen": "red", "mods": [sway(5, 0.6), {"type": "swing", "amp": -40}]},
          {"part": arm, "pos": c.rel(0.785, 0.42), "pivot": [0.92, 0.06], "flip": True, "pen": "red", "mods": [sway(5, 0.6, 0.5)]}]
    ch += crown_parts(c, 0.49, 0.105, 0.34) if crown else []
    build(c, feet(c, [0.64], 0.92, (0.4, 0.22), gen='golem_foot', amp=0.05, f=1.4), [walk(0.025, 2.8, 0), {"type": "recoil", "amp": 0.3, "dir": [-1, 0]}],
          [('glow', 'golem_glow', 'marker')], ch, feet(c, [0.34], 0.92, (0.4, 0.22), gen='golem_foot', amp=0.05, f=1.4))
def crown_parts(c, fx, fy, width):
    """Корона стоїть основою на маківці (точка fx, fy коробки тіла) — торкається, не накриває."""
    f = c.add_part('crown_fill', 'crown_fill', [width, width * 0.6]); l = c.add_part('crown_line', 'crown_line', [width, width * 0.6])
    pos = c.rel(fx, fy)
    return [{"part": f, "pos": pos, "pivot": [0.5, 1.0], "pen": "marker"}, {"part": l, "pos": pos, "pivot": [0.5, 1.0], "pen": "orange"}]

for fn in (imp, slime, cyclops, mushroom, ghost, spider, bat, rat, beetle, ogre, knight, turtle, golem): fn()
for fn in (ogre, knight, turtle, golem): fn(1.7, True)

# ------------------------------- запис -------------------------------
OLD = ('snowling', 'crawler', 'bathorn', 'bathking', 'imp', 'ogre')
lines = open(P, encoding='utf8').read().rstrip().split('\n')
assert lines[-1] == '}'
prefixes = set(OLD) | {pid.split('/')[0] for pid in PARTS}
keep = [l for l in lines[:-1] if not re.match(r'\s*"(%s)/' % '|'.join(sorted(prefixes)), l) and '"_monsters"' not in l and '"_bestiary"' not in l]
while keep and keep[-1].strip() == '': keep.pop()
keep[-1] = keep[-1].rstrip(',')
new = ['  "_bestiary": "Бестіарій lane (генератори — src/view/monsters.ts): частини не накладаються — вирости з контуру назовні, накладки олівцем/маркером мають коробку тіла, ноги під тілом, руки й крила збоку. line — товщина пера в клітинках, однакова для всіх частин одного ворога. Боси (*_king) — ті самі генератори в коробках ×1.7."']
for pid, (gen, size, ln) in PARTS.items():
    key = f'"{pid}":'
    new.append(f'  {key:<26}{{ "file": "proc:{gen}", "size": [{size[0]}, {size[1]}], "line": {ln} }}')
open(P, 'w', encoding='utf8').write('\n'.join(keep) + ',\n\n' + ',\n'.join(new) + '\n}\n')
json.load(open(P, encoding='utf8'))

s = open(R, encoding='utf8').read()
start = s.index('  "_look2"'); end = s.index('  "tree": {')
block = '  "_look2": "Бестіарій режиму lane — варіанти для шоуруму (showroom.html). Яку форму бере кожна роль, каже laneEnemies.json#*.rig; шоурум дозволяє перевизначити вибір для гри.",\n'
block += ',\n'.join(rig_txt(n, r) for n, r in RIGS.items()) + ',\n'
s = s[:start] + block + s[end:]
open(R, 'w', encoding='utf8').write(s)
json.load(open(R, encoding='utf8'))

e = open(E, encoding='utf8').read()
for a, b in [('"rig": "snowling"', '"rig": "imp"'), ('"rig": "crawler"', '"rig": "spider"'), ('"rig": "bathorn"', '"rig": "ogre"'), ('"rig": "bathking"', '"rig": "ogre_king"')]:
    e = e.replace(a, b)
open(E, 'w', encoding='utf8').write(e)
json.load(open(E, encoding='utf8'))
print('parts', len(PARTS), 'rigs', len(RIGS))
