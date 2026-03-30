const { connect } = require('puppeteer-real-browser');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function iniciarScraper() {
    console.log('--- Operação Dismatal: Blizzard de Eventos no Login ---');

    const { browser, page } = await connect({
        args: ["--start-maximized", "--no-sandbox"],
        headless: false,
        customConfig: {},
        skipTargetCheck: true
    });

    try {
        await page.setUserAgent(process.env.USER_AGENT_REAL);
        await page.setViewport({ width: 1366, height: 768 });

        console.log('Passo 1: Carregando Home e aguardando "Hidratação"...');
        await page.goto('https://b2b.dismatal.com.br/', { waitUntil: 'networkidle2', timeout: 60000 });
        
        // Espera 10 segundos para o JavaScript do site carregar completamente
        await new Promise(res => setTimeout(res, 10000));
        await page.screenshot({ path: '01-home-carregada.png' });

        console.log('Passo 2: Disparando Blizzard de Eventos no botão de login...');

        await page.evaluate(() => {
            const spans = [...document.querySelectorAll('span, a, div')];
            const alvo = spans.find(el => el.innerText.includes('Olá, faça seu login'));
            
            if (alvo) {
                const el = alvo.closest('a') || alvo;
                
                // Dispara uma sequência completa de eventos reais
                ['mouseenter', 'mouseover', 'mousedown', 'mouseup', 'click'].forEach(evtType => {
                    const evt = new MouseEvent(evtType, {
                        view: window,
                        bubbles: true,
                        cancelable: true,
                        buttons: 1
                    });
                    el.dispatchEvent(evt);
                });
                console.log('Eventos disparados via JS.');
            }
        });

        // Clique físico adicional para garantir
        const box = await page.evaluate(() => {
            const el = [...document.querySelectorAll('span, a')].find(e => e.innerText.includes('faça seu login'));
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        });

        if (box) {
            await page.mouse.move(box.x, box.y);
            await page.mouse.down();
            await new Promise(res => setTimeout(res, 100));
            await page.mouse.up();
        }

        console.log('Aguardando 10 segundos pelo Modal...');
        await new Promise(res => setTimeout(res, 10000));
        await page.screenshot({ path: '02-tentativa-modal.png' });

        // 🚩 O PLANO B: Se o modal não abrir, tentamos a URL de login pura (não o modal)
        const modalAberto = await page.$('input[type="password"]');
        if (!modalAberto) {
            console.log('⚠️ Modal não abriu. Tentando URL de login alternativa...');
            await page.goto('https://b2b.dismatal.com.br/login', { waitUntil: 'networkidle2' }).catch(() => {});
            await new Promise(res => setTimeout(res, 5000));
        }

        console.log('Passo 3: Buscando campos em frames e na página principal...');
        
        // Função para preencher onde quer que o campo de senha esteja
        const preencher = async (contexto) => {
            const senha = await contexto.$('input[type="password"]');
            if (senha) {
                const inputs = await contexto.$$('input');
                for (let input of inputs) {
                    const type = await (await input.getProperty('type')).jsonValue();
                    if (type === 'text' || type === 'email' || type === 'number') {
                        await input.type(process.env.DISMATAL_USER, { delay: 100 });
                    } else if (type === 'password') {
                        await input.type(process.env.DISMATAL_PASS, { delay: 100 });
                    }
                }
                return true;
            }
            return false;
        };

        // Procura na página principal e em todos os frames
        let sucessoPreenchimento = await preencher(page);
        if (!sucessoPreenchimento) {
            for (const frame of page.frames()) {
                if (await preencher(frame)) {
                    sucessoPreenchimento = true;
                    break;
                }
            }
        }

        if (sucessoPreenchimento) {
            console.log('✅ Dados inseridos!');
            await page.screenshot({ path: '03-dados-prontos.png' });
            await page.keyboard.press('Enter');
            await new Promise(res => setTimeout(res, 15000));
        } else {
            throw new Error('Não foi possível localizar os campos de login em lugar nenhum.');
        }

        // Finalização
        console.log('Verificando preço no produto final...');
        await page.goto('https://b2b.dismatal.com.br/produtos/1135574', { waitUntil: 'networkidle2' });
        await new Promise(res => setTimeout(res, 10000));
        
        const resultado = await page.evaluate(() => {
            const m = document.body.innerText.match(/R\$\s?([0-9.,]+)/);
            return m ? m[0] : null;
        });

        if (resultado) {
            const v = parseFloat(resultado.replace(/[^\d,]/g, '').replace(',', '.'));
            console.log(`✅ SUCESSO! R$ ${v}`);
            await supabase.from('precos_dismatal').insert({
                sku: '1135574',
                nome_produto: 'Disjuntor Dismatal',
                preco: v,
                url: 'https://b2b.dismatal.com.br/produtos/1135574'
            });
        } else {
            console.log('❌ Login falhou ou preço não carregou.');
            await page.screenshot({ path: '04-erro-final.png', fullPage: true });
            process.exit(1);
        }

    } catch (err) {
        console.error('ERRO:', err.message);
        await page.screenshot({ path: 'ERRO-CRITICO.png' });
        process.exit(1);
    } finally {
        await browser.close();
    }
}

iniciarScraper();
