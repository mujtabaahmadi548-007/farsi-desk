import { describe, expect, it } from 'vitest';
import { SAMPLE_SEGMENTS } from '../sample';
import { diffWords, tokenize } from './diff';
import { defaultNormalizeOptions, normalizePersian, normalizeText, type NormalizeOptions } from './persian';

const ZWNJ = '\u{200C}';
const AR_YE = '\u{064A}';
const AR_KAF = '\u{0643}';
const AR_ALEF_MAKSURA = '\u{0649}';
const KASHIDA = '\u{0640}';
const NBSP = '\u{00A0}';

const ALL = defaultNormalizeOptions('persian');
const KEEP_DIGITS = defaultNormalizeOptions('keep');
const only = (partial: Partial<NormalizeOptions>): NormalizeOptions => ({
  arabicLetters: false,
  digits: 'keep',
  zwnj: false,
  joinedVerbs: false,
  kashida: false,
  spaces: false,
  ...partial,
});
const n = (text: string, options: NormalizeOptions = KEEP_DIGITS) => normalizeText(text, options);
/** Shorthand: write ~ for the half-space so the expected strings are readable. */
const z = (text: string) => text.replaceAll('~', ZWNJ);

describe('Arabic letters → Persian letters', () => {
  it('converts Arabic yeh and kaf', () => {
    const input = `${AR_KAF}تاب عرب${AR_YE} ${AR_KAF}وچ${AR_KAF}`;
    const result = normalizePersian(input, only({ arabicLetters: true }));
    expect(result.text).toBe('کتاب عربی کوچک');
    expect(result.text).not.toContain(AR_YE);
    expect(result.text).not.toContain(AR_KAF);
    expect(result.changes.letters).toBe(4);
  });

  it('converts alef maksura used as a final yeh', () => {
    expect(n(`موس${AR_ALEF_MAKSURA} و عیس${AR_ALEF_MAKSURA}`, only({ arabicLetters: true }))).toBe('موسی و عیسی');
  });

  it('keeps hamza-yeh, teh marbuta and English text untouched', () => {
    const input = 'مسئله و دایرة‌المعارف — see Kafka, 1924';
    expect(n(input, only({ arabicLetters: true }))).toBe(input);
  });

  it('replaces PDF presentation forms with real letters', () => {
    // ARABIC LETTER SEEN INITIAL FORM + LAM-ALEF FINAL LIGATURE + MEEM ISOLATED FORM = سلام
    expect(n('\u{FEB3}\u{FEFC}\u{FEE1}', only({ arabicLetters: true }))).toBe('سلام');
    // FARSI YEH ISOLATED FORM and KEHEH ISOLATED FORM
    expect(n('\u{FBFC} \u{FB8E}', only({ arabicLetters: true }))).toBe('ی ک');
  });

  it('does nothing when switched off', () => {
    const input = `${AR_KAF}تاب`;
    expect(n(input, only({}))).toBe(input);
  });
});

describe('digits', () => {
  it('persian mode converts Latin and Arabic-Indic digits', () => {
    const result = normalizePersian('در سال 2024 و ٢٠٢٥', only({ digits: 'persian' }));
    expect(result.text).toBe('در سال ۲۰۲۴ و ۲۰۲۵');
    expect(result.changes.digits).toBe(8);
  });

  it('persian mode leaves digits that belong to English text', () => {
    expect(n('Windows 11 در سال 2021 منتشر شد', only({ digits: 'persian' }))).toBe('Windows 11 در سال ۲۰۲۱ منتشر شد');
    expect(n('بیماری COVID-19 و فایل MP3', only({ digits: 'persian' }))).toBe('بیماری COVID-19 و فایل MP3');
    expect(n('نشانی example.org/2024 را ببینید', only({ digits: 'persian' }))).toBe('نشانی example.org/2024 را ببینید');
    expect(n('از Python 3 استفاده کنید', only({ digits: 'persian' }))).toBe('از Python 3 استفاده کنید');
  });

  it('persian mode converts times, percentages and grouped numbers', () => {
    expect(n('ساعت 8:30 با 20% تخفیف و 12,500 عضو', only({ digits: 'persian' }))).toBe(
      'ساعت ۸:۳۰ با ۲۰% تخفیف و ۱۲,۵۰۰ عضو',
    );
  });

  it('a line that starts with a number follows the text after it', () => {
    expect(n('2024 سال خوبی بود', only({ digits: 'persian' }))).toBe('۲۰۲۴ سال خوبی بود');
    expect(n('2024 was a good year', only({ digits: 'persian' }))).toBe('2024 was a good year');
  });

  it('latin mode converts Persian and Arabic-Indic digits and their separators', () => {
    expect(n('۱۲۳ و ٤٥٦ و 789', only({ digits: 'latin' }))).toBe('123 و 456 و 789');
    expect(n('۳٫۵ درصد از ۱٬۲۰۰ نفر', only({ digits: 'latin' }))).toBe('3.5 درصد از 1,200 نفر');
  });

  it('keep mode only turns Arabic-Indic shapes into Persian ones', () => {
    expect(n('٤٥٦ و 123 و ۷', only({ digits: 'keep' }))).toBe('۴۵۶ و 123 و ۷');
  });
});

describe('half-space (ZWNJ)', () => {
  const zw = only({ zwnj: true, joinedVerbs: true });

  it('joins می and نمی to the verb with a half-space', () => {
    expect(n('من می روم و او نمی آید', zw)).toBe(z('من می~روم و او نمی~آید'));
    expect(n('می خواهم بدانم چه می شود', zw)).toBe(z('می~خواهم بدانم چه می~شود'));
  });

  it('also works with Arabic yeh when letters are fixed in the same pass', () => {
    expect(n(`م${AR_YE} روم`, KEEP_DIGITS)).toBe(z('می~روم'));
    expect(n(`نم${AR_YE} دانم`, zw)).toBe(z(`نم${AR_YE}~دانم`));
  });

  it('repairs a half-space typed next to a real space', () => {
    expect(n(z('می~ روم'), zw)).toBe(z('می~روم'));
    expect(n(z('می ~روم'), zw)).toBe(z('می~روم'));
  });

  it('does not touch the noun «می» or words that merely start with می', () => {
    for (const text of ['می و مطرب', 'می ناب', 'می خوردن حرام است', 'میز و میوه در میدان', 'قدیمی است', 'عمومی بود']) {
      expect(n(text, zw), text).toBe(text);
    }
  });

  it('splits verbs typed with no space at all, using the verb lexicon', () => {
    expect(n('میروم', zw)).toBe(z('می~روم'));
    expect(n('نمیدانم چرا نمیشود', zw)).toBe(z('نمی~دانم چرا نمی~شود'));
    expect(n('آنها میخواستند بیایند و میگفتند میتوانیم', zw)).toBe(z('آنها می~خواستند بیایند و می~گفتند می~توانیم'));
    expect(n('میتوان گفت که میآید', zw)).toBe(z('می~توان گفت که می~آید'));
  });

  it('never splits ordinary words that start with می or نمی', () => {
    const words = [
      'میز', 'میوه', 'میدان', 'میلیون', 'میان', 'میهن', 'میزان', 'میکروب', 'میمون', 'میراث', 'میخ', 'میگو',
      'میلاد', 'مینا', 'میهمان', 'میانگین', 'میدانی', 'میبد', 'نمیر',
    ];
    for (const word of words) expect(n(`این ${word} است`, zw), word).toBe(`این ${word} است`);
  });

  it('leaves joined verbs alone when the lexicon rule is off', () => {
    expect(n('میروم', only({ zwnj: true, joinedVerbs: false }))).toBe('میروم');
  });

  it('attaches ها and its forms', () => {
    expect(n('کتاب ها', zw)).toBe(z('کتاب~ها'));
    expect(n('کتاب های خوب', zw)).toBe(z('کتاب~های خوب'));
    expect(n('کتاب هایی که خواندم', zw)).toBe(z('کتاب~هایی که خواندم'));
    expect(n('دوست هایشان و کتاب هایم', zw)).toBe(z('دوست~هایشان و کتاب~هایم'));
    expect(n('این ها و آن ها', zw)).toBe(z('این~ها و آن~ها'));
  });

  it('writes no half-space after letters that do not join anyway', () => {
    expect(n('کار ها و برادر ها', zw)).toBe('کارها و برادرها');
    expect(n(z('کار~ها'), zw)).toBe('کارها');
    expect(n('بد تر', zw)).toBe('بدتر');
  });

  it('attaches تر and ترین', () => {
    expect(n('بزرگ تر', zw)).toBe(z('بزرگ~تر'));
    expect(n('بزرگ ترین شهر', zw)).toBe(z('بزرگ~ترین شهر'));
    expect(n('کوچک تری', zw)).toBe(z('کوچک~تری'));
    expect(n('مهم ترین ها', zw)).toBe(z('مهم~ترین~ها'));
  });

  it('does not treat «تر» (wet) after a preposition, or longer words, as a suffix', () => {
    expect(n('از تر و خشک', zw)).toBe('از تر و خشک');
    expect(n('او می ترسد', zw)).toBe(z('او می~ترسد'));
    expect(n('یک ترانه', zw)).toBe('یک ترانه');
    expect(n('دو هاون', zw)).toBe('دو هاون');
  });

  it('attaches ای / ی / ام / اند after a silent ه', () => {
    expect(n('خانه ای بزرگ', zw)).toBe(z('خانه~ای بزرگ'));
    expect(n('خانه ی من', zw)).toBe(z('خانه~ی من'));
    expect(n('من رفته ام و آنها آمده اند', zw)).toBe(z('من رفته~ام و آنها آمده~اند'));
    expect(n('نامه اش را خواندم', zw)).toBe(z('نامه~اش را خواندم'));
  });

  it('leaves the vocative «ای» and «ای کاش» alone', () => {
    for (const text of ['ای ایران', 'که ای دوست', 'اینکه ای کاش', 'گفته ای کاش می‌آمد', 'راه ای', 'کوه ای']) {
      expect(n(text, zw), text).toBe(text);
    }
  });

  it('removes duplicated and stray half-spaces', () => {
    expect(n(z('کتاب~~ها'), zw)).toBe(z('کتاب~ها'));
    expect(n(z('سلام~ دنیا~'), zw)).toBe('سلام دنیا');
    expect(n(z('~سلام، دنیا~.'), zw)).toBe('سلام، دنیا.');
  });

  it('keeps correct half-spaces exactly as they are', () => {
    const good = z('می~روم، نمی~دانم، کتاب~ها، بزرگ~ترین، خانه~ای، نیم~فاصله');
    const result = normalizePersian(good, ALL);
    expect(result.text).toBe(good);
    expect(result.changes.zwnj).toBe(0);
  });
});

describe('kashida', () => {
  it('removes kashida inside words', () => {
    const result = normalizePersian(`ب${KASHIDA}${KASHIDA}${KASHIDA}رای س${KASHIDA}لام`, only({ kashida: true }));
    expect(result.text).toBe('برای سلام');
    expect(result.changes.kashida).toBe(2);
  });

  it('keeps a free-standing kashida that is used as a dash', () => {
    const input = `تهران ${KASHIDA} ایران`;
    expect(n(input, only({ kashida: true }))).toBe(input);
  });
});

describe('spaces', () => {
  const sp = only({ spaces: true });

  it('collapses repeated spaces and trims', () => {
    expect(n('  سلام   دنیا  ', sp)).toBe('سلام دنیا');
    expect(n('خط یک  \n  خط دو', sp)).toBe('خط یک\nخط دو');
  });

  it('turns no-break and other special spaces into ordinary ones', () => {
    expect(n(`سلام${NBSP}دنیا\u{2009}!`, sp)).toBe('سلام دنیا!');
  });

  it('removes spaces before punctuation and inside brackets', () => {
    expect(n('رایگان است ، اما گران شد .', sp)).toBe('رایگان است، اما گران شد.');
    expect(n('چرا ؟ ( چون ) « نقل » [ الف ]', sp)).toBe('چرا؟ (چون) «نقل» [الف]');
    expect(n('ساعت : ده', sp)).toBe('ساعت: ده');
  });

  it('adds the missing space after Persian punctuation', () => {
    expect(n('سلام،خوبی؟من خوبم؛تو چطور', sp)).toBe('سلام، خوبی؟ من خوبم؛ تو چطور');
  });

  it('does not damage ellipses, decimals, grouped numbers or technical names', () => {
    for (const text of ['او رفت ... و برگشت', 'عدد ۳.۵ و ۱،۰۰۰', 'از .NET استفاده کنید', 'نشانی a.b/c?d=1']) {
      expect(n(text, sp), text).toBe(text);
    }
  });
});

describe('mixed Persian and English', () => {
  it('leaves English sentences completely alone', () => {
    const english = 'The quick brown fox (v2.0) jumps over 13 lazy dogs — "really"?';
    const result = normalizePersian(english, ALL);
    expect(result.text).toBe(english);
    expect(Object.values(result.changes).reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('normalizes the Persian around English words without touching them', () => {
    const input = `${AR_KAF}اربران م${AR_YE} توانند با نرم افزار «Libby» ${AR_KAF}تاب ها را در iPhone 15 بخوانند .`;
    expect(n(input, ALL)).toBe(z('کاربران می~توانند با نرم افزار «Libby» کتاب~ها را در iPhone 15 بخوانند.'));
  });
});

describe('whole pipeline', () => {
  it('cleans every sentence of the built-in sample', () => {
    const cleaned = SAMPLE_SEGMENTS.map((segment) => normalizeText(segment.source, ALL));
    expect(cleaned).toEqual([
      'اطلاعیه کتابخانه مرکزی',
      z('کتابخانه~ی مرکزی شهر در سال ۱۴۰۲ بیش از ۱۲,۵۰۰ عضو جدید پذیرفت.'),
      z('این کتابخانه هر روز از ساعت ۸ تا ۲۰ باز است و می~تواند به ۳۰۰ نفر خدمات بدهد.'),
      z('آیا می~دانید که بزرگ~ترین بخش آن، بخش کتاب~های دیجیتال است؟'),
      z('کاربران می~توانند با نرم افزار «Libby» کتاب~ها را روی تلفن همراه خود بخوانند.'),
      z('هر عضو می~تواند تا ۵ کتاب امانت بگیرد.'),
      'عضویت برای دانش آموزان رایگان است، اما دیگران باید سالانه ۱۵۰ هزار تومان بپردازند.',
      'برای اطلاعات بیشتر به وب سایت www.example.org مراجعه کنید.',
    ]);
  });

  it('the sample really contains the problems it is supposed to demonstrate', () => {
    const all = SAMPLE_SEGMENTS.map((segment) => segment.source).join('\n');
    expect(all).toContain(AR_YE);
    expect(all).toContain(AR_KAF);
    expect(all).toContain(KASHIDA);
    expect(all).toMatch(/ {2}/);
    expect(all).not.toContain(ZWNJ);
  });

  it('reports what it changed, by kind', () => {
    const result = normalizePersian(`${AR_KAF}تاب ها در سال 2024  منتشر ش${KASHIDA}دند .`, ALL);
    expect(result.text).toBe(z('کتاب~ها در سال ۲۰۲۴ منتشر شدند.'));
    expect(result.changes).toEqual({ letters: 1, digits: 4, zwnj: 1, kashida: 1, spaces: 2 });
  });

  it('is idempotent: a second pass changes nothing', () => {
    const inputs = [
      ...SAMPLE_SEGMENTS.map((segment) => segment.source),
      'من می روم،تو نمی آیی ؟  کتاب های بزرگ تر را خانه ی ما رفته اند .',
      z('می~ روم ~ کتاب~~ها'),
      'Mixed text با 3 کلمه and 42 numbers در سال 1403.',
    ];
    for (const options of [ALL, defaultNormalizeOptions('latin'), KEEP_DIGITS]) {
      for (const input of inputs) {
        const once = normalizePersian(input, options);
        const twice = normalizePersian(once.text, options);
        expect(twice.text, input).toBe(once.text);
        expect(Object.values(twice.changes).reduce((a, b) => a + b, 0), input).toBe(0);
      }
    }
  });

  it('handles empty input', () => {
    expect(normalizePersian('', ALL).text).toBe('');
  });
});

describe('diff used for the preview', () => {
  it('tokenizes without losing a character and keeps half-spaced words whole', () => {
    const text = z('او می~رود،  به «خانه» (2 بار).');
    const tokens = tokenize(text);
    expect(tokens.join('')).toBe(text);
    expect(tokens).toContain(z('می~رود'));
    expect(tokens).toContain('  ');
  });

  it('marks exactly the words the normalizer changed', () => {
    const before = `من م${AR_YE} روم به خانه`;
    const after = normalizeText(before, KEEP_DIGITS);
    const parts = diffWords(before, after);
    expect(parts.filter((p) => p.type === 'del').map((p) => p.text)).toEqual([`م${AR_YE} روم`]);
    expect(parts.filter((p) => p.type === 'ins').map((p) => p.text)).toEqual([z('می~روم')]);
    expect(parts.filter((p) => p.type !== 'ins').map((p) => p.text).join('')).toBe(before);
    expect(parts.filter((p) => p.type !== 'del').map((p) => p.text).join('')).toBe(after);
  });

  it('returns a single unchanged part for identical strings', () => {
    expect(diffWords('سلام دنیا', 'سلام دنیا')).toEqual([{ type: 'same', text: 'سلام دنیا' }]);
  });

  it('handles empty sides', () => {
    expect(diffWords('', 'سلام')).toEqual([{ type: 'ins', text: 'سلام' }]);
    expect(diffWords('سلام', '')).toEqual([{ type: 'del', text: 'سلام' }]);
    expect(diffWords('', '')).toEqual([]);
  });
});
