const { connect } = require('puppeteer-real-browser');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function iniciarScraper() {
    console.log('--- Operação Dismatal: Abrindo Pop-up de Login ---');

    const { browser, page } = await connect({
        args: ["--start-maximized", "--no-sandbox"],
        headless: false,
        customConfig: {},
        skipTargetCheck: true
    });

    try {
        await page.setUserAgent(process.env.USER_AGENT_REAL);
        await page.setViewport({ width: 1366, height: 768 });

        console.log('Passo 1: Acessando a Home Page...');
        await page.goto('https://b2b.dismatal.com.br/', { waitUntil: 'networkidle2', timeout: 60000 });
        await new Promise(res => setTimeout(res, 5000));
        await page.screenshot({ path: '01-home-carregada.png' });

        console.log('Passo 2: Clicando em "Olá, faça seu login"...');
        // Usamos um script para achar o elemento pelo texto exato, já que IDs mudam
        await page.evaluate(() => {
            const itens = [...document.querySelectorAll('a, div, span, p')];
            const botao = itens.find(el => el.innerText.includes('Olá, faça seu login'));
            if (botao) {
                botao.click();
            } else {
                throw new Error('Botão de login não encontrado pelo texto.');
            }
        });

        console.log('Aguardando 5 segundos pelo pop-up...');
        await new Promise(res => setTimeout(res, 5000));
        await page.screenshot({ path: '02-pop-up-visivel.png' });

        console.log('Passo 3: Preenchendo os dados dentro do pop-up...');
        // Tentamos localizar os campos dentro do modal
        await page.waitForSelector('input[type="password"]', { timeout: 10000 });
        
        // Seleciona todos os inputs da página (o modal estará no topo do DOM agora)
        const inputs = await page.$$('input');
        for (let input of inputs) {
            const type = await (await input.getProperty('type')).jsonValue();
            const isVisible = await input.boundingBox(); // Garante que estamos preenchando o que aparece
            
            if (isVisible) {
                if (type === 'text' || type === 'email') {
                    await input.click({ clickCount: 3 }); // Limpa se houver algo
                    await input.type(process.env.DISMATAL_USER, { delay: 100 });
                }
                if (type === 'password') {
                    await input.type(process.env.DISMATAL_PASS, { delay: 100 });
                }
            }
        }

        await page.screenshot({ path: '03-dados-preenchidos.png' });
        await page.keyboard.press('Enter');
        
        console.log('Login enviado. Aguardando processamento...');
        await new Promise(res => setTimeout(res, 15000));
        await page.screenshot({ path: '04-pos-login.png' });

        // Passo 4: Ir para o produto
        console.log('Passo 4: Indo para o SKU 1135574...');
        await page.goto('https://b2b.dismatal.com.br/produtos/1135574', { waitUntil: 'networkidle2' });
        await new Promise(res => setTimeout(res, 10000));
        await page.screenshot({ path: '05-produto-final.png' });

        const data = await page.evaluate(() => {
            const precoMatch = document.body.innerText.match(/R\$\s?([0-9.,]+)/);
            return {
                preco: precoMatch ? precoMatch[0] : null,
                logado: !document.body.innerText.includes('Olá, faça seu login')
            };
        });

        if (data.preco && data.logado) {
            const valorFinal = parseFloat(data.preco.replace(/[^\d,]/g, '').replace(',', '.'));
            console.log(`✅ SUCESSO DISMATAL: R$ ${valorFinal}`);
            
            await supabase.from('precos_dismatal').insert({
                sku: '1135574',
                nome_produto: 'Disjuntor Dismatal',
                preco: valorFinal,
                url: 'https://b2b.dismatal.com.br/produtos/1135574'
            });
            console.log('Gravado no Supabase.');
        } else {
            console.log(`❌ Falha. Logado: ${data.logado} | Preço: ${data.preco}`);
            process.exit(1);
        }

    } catch (err) {
        console.error('FALHA GERAL:', err.message);
        await page.screenshot({ path: 'ERRO-POPUP.png' });
        process.exit(1);
    } finally {
        await browser.close();
    }
}

iniciarScraper();
