const { connect } = require('puppeteer-real-browser');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function iniciarScraper() {
    console.log('--- Operação Dismatal: Mira Laser no Login ---');

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
        await page.screenshot({ path: '01-home-estatica.png' });

        console.log('Passo 2: Tentando disparar o Pop-up...');

        // 🚩 ESTRATÉGIA DE CLIQUE TRIPLA
        await page.evaluate(() => {
            // 1. Procura o link que contém o texto de login
            const links = [...document.querySelectorAll('a')];
            const btnLogin = links.find(a => a.innerText.includes('faça seu login'));
            
            if (btnLogin) {
                console.log('Botão encontrado. Disparando clique via JS...');
                btnLogin.click(); // Clique 1: Programático
                
                // Clique 2: Disparando evento de mouse manual no centro do botão
                const rect = btnLogin.getBoundingClientRect();
                const evt = new MouseEvent('click', {
                    view: window,
                    bubbles: true,
                    cancelable: true,
                    clientX: rect.left + rect.width / 2,
                    clientY: rect.top + rect.height / 2
                });
                btnLogin.dispatchEvent(evt);
            }
        });

        // Clique 3: Clique físico do Puppeteer nas coordenadas
        const coords = await page.evaluate(() => {
            const el = [...document.querySelectorAll('a')].find(a => a.innerText.includes('faça seu login'));
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        });

        if (coords) {
            await page.mouse.click(coords.x, coords.y);
            console.log(`Clique físico executado em: ${coords.x}, ${coords.y}`);
        }

        console.log('Aguardando 10 segundos pelo Modal...');
        await new Promise(res => setTimeout(res, 10000));
        await page.screenshot({ path: '02-pos-clique-total.png' });

        // Passo 3: Preenchimento (Mesmo que o modal pareça invisível no print)
        console.log('Buscando inputs de login na página inteira...');
        
        // Verifica se o campo de senha apareceu em algum lugar do código
        const inputsEncontrados = await page.evaluate((u, p) => {
            const campos = [...document.querySelectorAll('input')];
            const userField = campos.find(i => i.type === 'text' || i.type === 'email' || i.name.includes('login'));
            const passField = campos.find(i => i.type === 'password');
            
            if (userField && passField) {
                userField.value = u;
                passField.value = p;
                userField.dispatchEvent(new Event('input', { bubbles: true }));
                passField.dispatchEvent(new Event('input', { bubbles: true }));
                return true;
            }
            return false;
        }, process.env.DISMATAL_USER, process.env.DISMATAL_PASS);

        if (inputsEncontrados) {
            console.log('✅ Inputs localizados e preenchidos via Injeção JS!');
            await page.screenshot({ path: '03-dados-preenchidos.png' });
            await page.keyboard.press('Enter');
            await new Promise(res => setTimeout(res, 15000));
        } else {
            console.log('❌ Modal não abriu ou inputs não foram localizados.');
            process.exit(1);
        }

        // Navegação final
        console.log('Passo 4: Verificando produto...');
        await page.goto('https://b2b.dismatal.com.br/produtos/1135574', { waitUntil: 'networkidle2' });
        await new Promise(res => setTimeout(res, 10000));
        await page.screenshot({ path: '04-resultado-final.png' });

        const preco = await page.evaluate(() => {
            const m = document.body.innerText.match(/R\$\s?([0-9.,]+)/);
            return m ? m[0] : null;
        });

        if (preco) {
            const valor = parseFloat(preco.replace(/[^\d,]/g, '').replace(',', '.'));
            console.log(`✅ SUCESSO! Preço: R$ ${valor}`);
            await supabase.from('precos_dismatal').insert({
                sku: '1135574',
                nome_produto: 'Disjuntor Dismatal',
                preco: valor,
                url: 'https://b2b.dismatal.com.br/produtos/1135574'
            });
        } else {
            console.log('❌ Logado, mas preço não apareceu.');
            process.exit(1);
        }

    } catch (err) {
        console.error('ERRO:', err.message);
        await page.screenshot({ path: 'ERRO-GERAL.png' });
        process.exit(1);
    } finally {
        await browser.close();
    }
}

iniciarScraper();
