const { connect } = require('puppeteer-real-browser');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function iniciarScraper() {
    console.log('--- Operação Dismatal: Preenchimento do Modal ---');

    const { browser, page } = await connect({
        args: ["--start-maximized", "--no-sandbox"],
        headless: false,
        customConfig: {},
        skipTargetCheck: true
    });

    try {
        await page.setUserAgent(process.env.USER_AGENT_REAL);
        await page.setViewport({ width: 1366, height: 768 });

        console.log('Passo 1: Carregando Home...');
        await page.goto('https://b2b.dismatal.com.br/', { waitUntil: 'networkidle2', timeout: 60000 });
        await new Promise(res => setTimeout(res, 8000));

        console.log('Passo 2: Disparando o Pop-up...');
        await page.evaluate(() => {
            const btn = [...document.querySelectorAll('a, span, div')].find(el => el.innerText.includes('faça seu login'));
            if (btn) btn.click();
        });

        // 🚩 NOVIDADE: Aguarda o modal estar visível no DOM
        console.log('Aguardando campos de login ficarem clicáveis...');
        await page.waitForSelector('input[type="password"]', { timeout: 15000 });
        await new Promise(res => setTimeout(res, 3000)); // Delay de segurança para animação do modal
        await page.screenshot({ path: '01-modal-aberto.png' });

        console.log('Passo 3: Digitando credenciais...');

        // 🚩 TÉCNICA DE FOCO: Clicamos no campo antes de digitar para "acordar" o formulário
        const inputs = await page.$$('input');
        for (let input of inputs) {
            const type = await (await input.getProperty('type')).jsonValue();
            const isVisible = await input.boundingBox();

            if (isVisible) {
                if (type === 'text' || type === 'email') {
                    console.log('Preenchendo Usuário...');
                    await input.click({ clickCount: 3 });
                    await input.type(process.env.DISMATAL_USER, { delay: 150 });
                } else if (type === 'password') {
                    console.log('Preenchendo Senha...');
                    await input.click();
                    await input.type(process.env.DISMATAL_PASS, { delay: 150 });
                }
            }
        }

        await page.screenshot({ path: '02-dados-digitados.png' });
        
        // Pressiona Enter e aguarda a transição de página
        console.log('Enviando Login...');
        await Promise.all([
            page.keyboard.press('Enter'),
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => console.log('Timeout na navegação, seguindo...'))
        ]);

        await new Promise(res => setTimeout(res, 10000));
        await page.screenshot({ path: '03-pos-login.png' });

        // Passo 4: Verificação do Produto
        console.log('Passo 4: Verificando SKU 1135574...');
        await page.goto('https://b2b.dismatal.com.br/produtos/1135574', { waitUntil: 'networkidle2' });
        await new Promise(res => setTimeout(res, 10000));
        await page.screenshot({ path: '04-resultado-final.png' });

        const preco = await page.evaluate(() => {
            const m = document.body.innerText.match(/R\$\s?([0-9.,]+)/);
            return m ? m[0] : null;
        });

        if (preco) {
            const valor = parseFloat(preco.replace(/[^\d,]/g, '').replace(',', '.'));
            console.log(`✅ SUCESSO! R$ ${valor}`);
            await supabase.from('precos_dismatal').insert({
                sku: '1135574',
                nome_produto: 'Disjuntor Dismatal',
                preco: valor,
                url: 'https://b2b.dismatal.com.br/produtos/1135574'
            });
        } else {
            console.log('❌ Login provavelmente falhou ou preço não carregou.');
            process.exit(1);
        }

    } catch (err) {
        console.error('ERRO:', err.message);
        await page.screenshot({ path: 'ERRO-MODAL.png' });
        process.exit(1);
    } finally {
        await browser.close();
    }
}

iniciarScraper();
