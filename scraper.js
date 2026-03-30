const { connect } = require('puppeteer-real-browser');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function iniciarScraper() {
    console.log('--- Kore E-com: Operação Dismatal (Resiliência Total) ---');

    const { browser, page } = await connect({
        args: ["--start-maximized", "--no-sandbox"],
        headless: false,
        customConfig: {},
        skipTargetCheck: true
    });

    try {
        await page.setUserAgent(process.env.USER_AGENT_REAL);
        await page.setViewport({ width: 1366, height: 768 });

        // 1. ACESSO E CLIQUE
        console.log('Passo 1: Acessando Home e disparando Login...');
        await page.goto('https://b2b.dismatal.com.br/', { waitUntil: 'networkidle2', timeout: 90000 });
        await new Promise(res => setTimeout(res, 10000));

        await page.evaluate(() => {
            const btn = [...document.querySelectorAll('a, span, div')].find(el => el.innerText.includes('faça seu login'));
            if (btn) {
                const el = btn.closest('a') || btn;
                el.click(); // Clique programático
                el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            }
        });

        // Espera agressiva pelo modal/iframe
        console.log('Aguardando 15s pela estabilização do modal...');
        await new Promise(res => setTimeout(res, 15000));
        await page.screenshot({ path: '01-modal-debug.png' });

        // 2. INFILTRAÇÃO NO LOGIN
        let contextoLogin = null;
        
        // Tenta achar em frames primeiro (mais provável no B2B)
        const frames = page.frames();
        for (const f of frames) {
            const input = await f.$('input[type="password"]');
            if (input) {
                contextoLogin = f;
                console.log('✅ Frame de login identificado!');
                break;
            }
        }

        // Se não achou em frames, tenta na página principal
        if (!contextoLogin) {
            const inputPagina = await page.$('input[type="password"]');
            if (inputPagina) contextoLogin = page;
        }

        if (contextoLogin) {
            console.log('Injetando credenciais...');
            await contextoLogin.evaluate((u, p) => {
                const campos = [...document.querySelectorAll('input')];
                const user = campos.find(i => i.type === 'text' || i.name.includes('login') || i.id.includes('login'));
                const pass = campos.find(i => i.type === 'password');
                if (user && pass) {
                    user.value = u; pass.value = p;
                    user.dispatchEvent(new Event('input', { bubbles: true }));
                    pass.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }, process.env.DISMATAL_USER, process.env.DISMATAL_PASS);

            await page.keyboard.press('Enter');
            console.log('Login enviado. Aguardando processamento...');
            await new Promise(res => setTimeout(res, 20000));
        } else {
            console.log('⚠️ Aviso: Modal não detectado. Tentando seguir assim mesmo...');
        }

        // 3. COLETA DE DADOS (PREÇO PROMO + ESTOQUE + NOME)
        const urlAlvo = 'https://b2b.dismatal.com.br/produtos/1135574';
        console.log('Passo 2: Extraindo dados do SKU 1135574...');
        await page.goto(urlAlvo, { waitUntil: 'networkidle2' });
        await new Promise(res => setTimeout(res, 10000));
        await page.screenshot({ path: '02-produto-final.png' });

        const dados = await page.evaluate(() => {
            const h1 = document.querySelector('h1')?.innerText?.trim() || document.title;
            
            // Lógica do Menor Preço (Sniper)
            const matches = [...document.body.innerText.matchAll(/R\$\s?([0-9.,]+)/g)];
            const precos = matches.map(m => {
                return parseFloat(m[1].replace(/\./g, '').replace(',', '.'));
            }).filter(n => n > 0);
            
            const precoPromocional = precos.length > 0 ? Math.min(...precos) : null;

            // Lógica de Estoque
            const texto = document.body.innerText.toLowerCase();
            let estoqueStatus = "Esgotado/Não achado";
            const matchNum = texto.match(/(\d+)\s*(unidade|unid|un)/);
            
            if (matchNum) {
                estoqueStatus = `${matchNum[1]} unidades`;
            } else if (texto.includes('em estoque') || texto.includes('disponível')) {
                estoqueStatus = "Disponível";
            }

            return { nome: h1, preco: precoPromocional, estoque: estoqueStatus };
        });

        // 4. PERSISTÊNCIA NO SUPABASE
        if (dados.preco) {
            console.log(`🚀 SUCESSO: ${dados.nome} | R$ ${dados.preco} | Estoque: ${dados.estoque}`);
            
            const { error } = await supabase.from('precos_dismatal').insert({
                sku: '1135574',
                nome_produto: dados.nome,
                preco: dados.preco,
                estoque: dados.estoque,
                url: urlAlvo
            });

            if (error) throw error;
            console.log('Dados salvos com sucesso!');
        } else {
            console.log('❌ Erro: O preço promocional não foi encontrado.');
            process.exit(1);
        }

    } catch (err) {
        console.error('ERRO CRÍTICO:', err.message);
        await page.screenshot({ path: 'ERRO-OPERACAO.png', fullPage: true });
        process.exit(1);
    } finally {
        await browser.close();
    }
}

iniciarScraper();
