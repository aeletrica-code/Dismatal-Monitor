const { connect } = require('puppeteer-real-browser');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function iniciarScraper() {
    console.log('--- Operação Dismatal: Clique de Precisão no Login ---');

    const { browser, page } = await connect({
        args: ["--start-maximized", "--no-sandbox"],
        headless: false,
        customConfig: {},
        skipTargetCheck: true
    });

    try {
        await page.setUserAgent(process.env.USER_AGENT_REAL);
        await page.setViewport({ width: 1366, height: 768 });

        console.log('Passo 1: Acessando Home Page...');
        await page.goto('https://b2b.dismatal.com.br/', { waitUntil: 'networkidle2', timeout: 60000 });
        await new Promise(res => setTimeout(res, 7000));

        console.log('Passo 2: Localizando e Clicando no Login...');
        
        // Estratégia: Procura o elemento que contém o texto e sobe até o pai que é clicável
        const loginBotao = await page.evaluateHandle(() => {
            const spans = [...document.querySelectorAll('span, div, a')];
            const alvo = spans.find(el => el.innerText.includes('Olá, faça seu login'));
            return alvo ? alvo.closest('a') || alvo.closest('div') || alvo : null;
        });

        if (loginBotao) {
            console.log('Botão encontrado! Forçando clique...');
            // Move o mouse até o botão e clica (simula humano perfeitamente)
            await loginBotao.click();
        } else {
            throw new Error('Não consegui achar o botão "Olá, faça seu login" no código.');
        }

        console.log('Aguardando 8 segundos para o Pop-up aparecer...');
        await new Promise(res => setTimeout(res, 8000));
        await page.screenshot({ path: '02-tentativa-popup.png' });

        // VERIFICAÇÃO: O pop-up apareceu?
        const temModal = await page.evaluate(() => {
            const modal = document.querySelector('.modal-content, .popup, [class*="modal"], [class*="popup"]');
            return !!modal && modal.innerText.toLowerCase().includes('senha');
        });

        if (!temModal) {
            console.log('⚠️ Pop-up não detectado visualmente. Tentando preencher "no escuro"...');
        }

        console.log('Passo 3: Preenchendo campos de login...');
        // Espera especificamente pelo campo de senha que só aparece no login
        await page.waitForSelector('input[type="password"]', { timeout: 10000 });
        
        // Digita os dados
        await page.focus('input[type="password"]'); // Foca na senha primeiro para garantir
        const inputs = await page.$$('input');
        for (let input of inputs) {
            const type = await (await input.getProperty('type')).jsonValue();
            const name = await (await input.getProperty('name')).jsonValue();
            
            if (type === 'text' || type === 'email' || name.includes('login')) {
                await input.click({ clickCount: 3 });
                await input.type(process.env.DISMATAL_USER, { delay: 150 });
            }
            if (type === 'password') {
                await input.type(process.env.DISMATAL_PASS, { delay: 150 });
            }
        }

        await page.screenshot({ path: '03-campos-preenchidos.png' });
        await page.keyboard.press('Enter');
        
        console.log('Login enviado. Aguardando processamento...');
        await new Promise(res => setTimeout(res, 15000));

        // Indo para o produto
        console.log('Passo 4: Indo para o produto...');
        await page.goto('https://b2b.dismatal.com.br/produtos/1135574', { waitUntil: 'networkidle2' });
        await new Promise(res => setTimeout(res, 10000));
        await page.screenshot({ path: '04-resultado-final.png' });

        const precoFinal = await page.evaluate(() => {
            const matches = document.body.innerText.match(/R\$\s?([0-9.,]+)/);
            return matches ? matches[0] : null;
        });

        if (precoFinal) {
            const valor = parseFloat(precoFinal.replace(/[^\d,]/g, '').replace(',', '.'));
            console.log(`✅ SUCESSO DISMATAL: R$ ${valor}`);
            
            await supabase.from('precos_dismatal').insert({
                sku: '1135574',
                nome_produto: 'Disjuntor Dismatal',
                preco: valor,
                url: 'https://b2b.dismatal.com.br/produtos/1135574'
            });
        } else {
            console.log('❌ O preço não apareceu. Verifique se o login foi concluído no print 04.');
            process.exit(1);
        }

    } catch (err) {
        console.error('ERRO:', err.message);
        await page.screenshot({ path: 'ERRO-DETALHADO.png', fullPage: true });
        process.exit(1);
    } finally {
        await browser.close();
    }
}

iniciarScraper();
