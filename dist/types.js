/**
 * The shapes this package exchanges with your Worker.
 *
 * Declared here, structurally, instead of pulling `@cloudflare/workers-types`
 * in: a package with zero dependencies cannot ask its users to install a
 * type package, and a structural interface is satisfied by the real
 * `D1Database` and `HTMLRewriter` without any cast.
 */

/** `essential` is never blocked. The other two are what a visitor can refuse. */
                                                                 

/** One decision, as stored in the `__consent` cookie. */
                       
                  
                        
     
                                                                               
                                                                              
                                                                              
     
             
                      
             
  

/** A third party recognised by the URL it loads, whether or not its tag is marked. */
                                                             

                                                           

/**
 * Everything a visitor reads. Values are inserted as HTML, so a link in `body`
 * works, and so does a mistake: this comes from your config, never from a
 * visitor.
 *
 * A category missing from `categories` is not offered, and "Accept all" does
 * not grant it. That is how a site with no marketing tracker hides it.
 */
                    
                
               
                 
                 
                    
               
                     
                    
                          
                                                        
  

/**
 * Colours and shape. Any CSS value works, including `var(--your-token)`: with
 * tokens that already switch in dark mode, leave the `dark*` keys out and the
 * banner follows the site for free.
 */
                     
                 
                     
                 
               
                  
               
                
                 
                                                                               
                                                                         
                       
                    
                     
                      
                      
                          
  

                             
                                                                                                     
               
     
                                                                             
                                                                              
               
     
                         
                                                                                                        
                     
     
                                                                           
                                                     
    
                                                                       
                                                                               
                                               
     
                                     
     
                                                                               
                                                                           
                                                             
     
                                       
                                                                                  
                         
     
                                                                              
                                                                        
                                                                                
                                  
     
                        
     
                                                                            
                                                                           
                                                                              
               
     
                                  
                                                                                                  
                           
     
                                                                               
                                                                               
                                                  
     
                              
  

/** The Worker bindings the engine reads. All are optional. */
                          
                                                                                                         
              
                                                                                           
                      
     
                                                                                                     
                                                                                                       
                                                                                                     
     
                                    
  

/** The sliver of a Workers Rate Limiting binding used here. */
                                  
                                                                 
 

/** What D1 reports about a statement. Only the three counters the purge cost is read from. */
                                                                                     

/** The sliver of D1 used here. The real `D1Database` satisfies it. */
                         
                                                                                                                   
 

/**
 * What a visitor was shown for one version of a site's banner: stored once per
 * version in `consent_policy`, and pointed at by `consent_log.policy_hash`.
 */
                              
               
                        
                                 
                                                                            
                           
                    
                                    
                                                                                           
                             
  

/* The sliver of HTMLRewriter used here. Injectable so tests can run in Node. */
                                  
                                            
                                                  
                                      
                                                               
                                                                       
                                                                                                          
 

                               
                                                                                             
                                                                                                                           
                                          
 

                                                         

                                 
                                                               
                                     
  
